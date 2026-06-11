// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#include "ucx_transport.h"

#ifdef HAVE_UCX

#include "logger.hpp"

#include <arpa/inet.h>
#include <cstdio>
#include <cstring>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

UCXTransport::UCXTransport() = default;

UCXTransport::~UCXTransport() { Disconnect(); }

void UCXTransport::SendHandler(void * /*request*/, ucs_status_t /*status*/,
                               void * /*user_data*/) {}

void UCXTransport::RecvHandler(void * /*request*/, ucs_status_t /*status*/,
                               const ucp_tag_recv_info_t * /*info*/,
                               void * /*user_data*/) {}

void UCXTransport::EpErrorHandler(void * /*arg*/, ucp_ep_h /*ep*/,
                                  ucs_status_t status) {
  LOG(ERROR) << "UCX endpoint error: " << ucs_status_string(status);
}

bool UCXTransport::WaitForRequest(ucs_status_ptr_t request) {
  if (request == nullptr) {
    return true;
  }
  if (UCS_PTR_IS_ERR(request)) {
    LOG(ERROR) << "UCX request failed: "
               << ucs_status_string(UCS_PTR_STATUS(request));
    return false;
  }
  while (ucp_request_check_status(request) == UCS_INPROGRESS) {
    ucp_worker_progress(worker_);
  }
  ucs_status_t status = ucp_request_check_status(request);
  ucp_request_free(request);
  if (status != UCS_OK) {
    LOG(ERROR) << "UCX request completed with error: "
               << ucs_status_string(status);
    return false;
  }
  return true;
}

bool UCXTransport::Connect(const std::string &host, uint16_t port) {
  if (connected_) {
    return true;
  }

  ucp_params_t params{};
  params.field_mask = UCP_PARAM_FIELD_FEATURES;
  params.features = UCP_FEATURE_TAG;

  ucs_status_t st = ucp_init(&params, nullptr, &ctx_);
  if (st != UCS_OK) {
    LOG(ERROR) << "ucp_init failed: " << ucs_status_string(st);
    return false;
  }

  ucp_worker_params_t worker_params{};
  worker_params.field_mask = UCP_WORKER_PARAM_FIELD_THREAD_MODE;
  worker_params.thread_mode = UCS_THREAD_MODE_SINGLE;
  st = ucp_worker_create(ctx_, &worker_params, &worker_);
  if (st != UCS_OK) {
    LOG(ERROR) << "ucp_worker_create failed: " << ucs_status_string(st);
    Disconnect();
    return false;
  }

  // Resolve server address
  struct addrinfo hints {
  }, *result = nullptr;
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  int gai_ret =
      getaddrinfo(host.c_str(), std::to_string(port).c_str(), &hints, &result);
  if (gai_ret != 0 || result == nullptr) {
    LOG(ERROR) << "Failed to resolve " << host << ":" << port;
    Disconnect();
    return false;
  }

  // Must set ERR_HANDLING_MODE_PEER to match the native UCX server
  ucp_ep_params_t ep_params{};
  ep_params.field_mask =
      UCP_EP_PARAM_FIELD_FLAGS | UCP_EP_PARAM_FIELD_SOCK_ADDR |
      UCP_EP_PARAM_FIELD_ERR_HANDLING_MODE | UCP_EP_PARAM_FIELD_ERR_HANDLER;
  ep_params.flags = UCP_EP_PARAMS_FLAGS_CLIENT_SERVER;
  ep_params.err_mode = UCP_ERR_HANDLING_MODE_PEER;
  ep_params.err_handler.cb = EpErrorHandler;
  ep_params.err_handler.arg = nullptr;
  ep_params.sockaddr.addr = result->ai_addr;
  ep_params.sockaddr.addrlen = result->ai_addrlen;

  st = ucp_ep_create(worker_, &ep_params, &server_ep_);
  freeaddrinfo(result);
  if (st != UCS_OK) {
    LOG(ERROR) << "ucp_ep_create failed: " << ucs_status_string(st);
    Disconnect();
    return false;
  }

  // Drive progress to complete the connection handshake before returning.
  // Without this, the server's conn_handler won't fire until both sides
  // exchange wireup messages, which requires ucp_worker_progress on the client.
  ucp_request_param_t flush_param{};
  ucs_status_ptr_t flush_req = ucp_ep_flush_nbx(server_ep_, &flush_param);
  if (!WaitForRequest(flush_req)) {
    LOG(ERROR) << "UCX endpoint flush failed; rejecting connection";
    Disconnect();
    return false;
  }

  connected_ = true;
  LOG(INFO) << "UCX connected to " << host << ":" << port;

  // Log available transport lanes for this endpoint.
  // UCX picks from these per transfer based on memory type and buffer size.
  char *buf = nullptr;
  size_t buf_len = 0;
  FILE *stream = open_memstream(&buf, &buf_len);
  if (stream) {
    ucp_ep_print_info(server_ep_, stream);
    fclose(stream);
    if (buf) {
      LOG(INFO) << "UCX available transport lanes "
                << "(e.g. rc_mlx5 = InfiniBand, tcp = fallback, "
                << "cuda_copy = GPU staging):\n"
                << buf;
      free(buf);
    }
  }
  LOG(INFO)
      << "Set UCX_LOG_LEVEL=info to see which lane is selected per transfer";

  return true;
}

void *UCXTransport::PostRecv(void *buf, size_t nbytes, uint64_t tag, bool gpu) {
  if (!connected_) {
    LOG(ERROR) << "UCX not connected";
    return UCS_STATUS_PTR(UCS_ERR_NOT_CONNECTED);
  }

  ucp_request_param_t param{};
  param.op_attr_mask =
      UCP_OP_ATTR_FIELD_CALLBACK | UCP_OP_ATTR_FIELD_MEMORY_TYPE;
  param.cb.recv = RecvHandler;
  param.memory_type = gpu ? UCS_MEMORY_TYPE_CUDA : UCS_MEMORY_TYPE_HOST;

  void *req = ucp_tag_recv_nbx(worker_, buf, nbytes, tag, UINT64_MAX, &param);
  pending_recv_ = req;
  return req;
}

bool UCXTransport::WaitRecv(void *recv_request) {
  bool ok = WaitForRequest(static_cast<ucs_status_ptr_t>(recv_request));
  pending_recv_ = nullptr;
  return ok;
}

void UCXTransport::CancelPendingRecv() {
  if (!pending_recv_ || UCS_PTR_IS_ERR(pending_recv_)) {
    pending_recv_ = nullptr;
    return;
  }
  ucp_request_cancel(worker_, pending_recv_);
  while (ucp_request_check_status(
             static_cast<ucs_status_ptr_t>(pending_recv_)) == UCS_INPROGRESS) {
    ucp_worker_progress(worker_);
  }
  ucp_request_free(pending_recv_);
  pending_recv_ = nullptr;
}

void UCXTransport::Disconnect() {
  CancelPendingRecv();
  if (server_ep_) {
    ucp_request_param_t close_param{};
    close_param.op_attr_mask = UCP_OP_ATTR_FIELD_FLAGS;
    close_param.flags = UCP_EP_CLOSE_FLAG_FORCE;
    ucs_status_ptr_t close_req = ucp_ep_close_nbx(server_ep_, &close_param);
    if (close_req != nullptr && !UCS_PTR_IS_ERR(close_req)) {
      while (ucp_request_check_status(close_req) == UCS_INPROGRESS) {
        ucp_worker_progress(worker_);
      }
      ucp_request_free(close_req);
    }
    server_ep_ = nullptr;
  }
  if (worker_) {
    ucp_worker_destroy(worker_);
    worker_ = nullptr;
  }
  if (ctx_) {
    ucp_cleanup(ctx_);
    ctx_ = nullptr;
  }
  connected_ = false;
}

#endif // HAVE_UCX
