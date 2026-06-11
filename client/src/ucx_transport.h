// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#pragma once

#ifdef HAVE_UCX

#include <cstdint>
#include <string>

#include <ucp/api/ucp.h>

class UCXTransport {
public:
  UCXTransport();
  ~UCXTransport();

  UCXTransport(const UCXTransport &) = delete;
  UCXTransport &operator=(const UCXTransport &) = delete;
  UCXTransport(UCXTransport &&) = delete;
  UCXTransport &operator=(UCXTransport &&) = delete;

  bool Connect(const std::string &host, uint16_t port);

  // Non-blocking receive split into post + wait to avoid a deadlock with
  // UCX's rendezvous protocol (used for buffers > ~256 KB, i.e. almost all
  // CIR/CFR transfers).
  //
  // In rendezvous mode the sender's ucp_tag_send blocks until the receiver
  // has posted a matching tag receive. Because the server performs its send
  // inside the gRPC handler, the client must register the receive buffer
  // with UCX *before* issuing the gRPC request:
  //
  //   1. PostRecv()          – registers the buffer; returns immediately
  //   2. gRPC request        – tells the server to send (server calls
  //                            ucp_tag_send, which finds the matching recv
  //                            and proceeds)
  //   3. WaitRecv()          – polls the UCX worker until the transfer
  //                            completes
  //
  // Calling a blocking recv after the gRPC request would deadlock: the gRPC
  // call blocks the client, and the server's send blocks waiting for a
  // matching recv that never gets posted.
  void *PostRecv(void *buf, size_t nbytes, uint64_t tag, bool gpu);
  bool WaitRecv(void *recv_request);

  void Disconnect();

  bool IsConnected() const { return connected_; }

private:
  static void SendHandler(void *request, ucs_status_t status, void *user_data);
  static void RecvHandler(void *request, ucs_status_t status,
                          const ucp_tag_recv_info_t *info, void *user_data);
  static void EpErrorHandler(void *arg, ucp_ep_h ep, ucs_status_t status);
  bool WaitForRequest(ucs_status_ptr_t request);

  void CancelPendingRecv();

  ucp_context_h ctx_ = nullptr;
  ucp_worker_h worker_ = nullptr;
  ucp_ep_h server_ep_ = nullptr;
  void *pending_recv_ = nullptr;
  bool connected_ = false;
};

#else

// No-op stub so client.h/cpp compile without #ifdef around every UCX call.
class UCXTransport {
public:
  UCXTransport() = default;
  ~UCXTransport() = default;
  bool Connect(const std::string &, uint16_t) { return false; }
  void *PostRecv(void *, size_t, uint64_t, bool) { return nullptr; }
  bool WaitRecv(void *) { return false; }
  void Disconnect() {}
  bool IsConnected() const { return false; }
};

#endif
