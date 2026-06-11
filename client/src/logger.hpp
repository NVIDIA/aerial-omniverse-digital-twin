// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// All rights reserved. SPDX-License-Identifier: Apache-2.0

#pragma once
#include <iostream>
#include <sstream>

class Logger {
public:
  enum Level { kINFO, kDEBUG, kWARNING, kERROR };
  Logger(Level level) : level_(level) {}
  ~Logger() {
    if (level_ == kERROR)
      std::cerr << ss_.str() << std::endl;
    else
      std::cout << ss_.str() << std::endl;
  }
  template <typename T> Logger &operator<<(const T &msg) {
    ss_ << msg;
    return *this;
  }

private:
  Level level_;
  std::stringstream ss_;
};

#define LOG(level) Logger(Logger::k##level)
