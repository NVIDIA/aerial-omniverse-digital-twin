FROM nvidia/cuda:13.1.1-devel-ubuntu24.04

RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        cmake build-essential pkg-config git curl \
        clang-format \
        libgrpc++-dev libprotobuf-dev protobuf-compiler protobuf-compiler-grpc \
        libucx-dev \
        python3 python3-pip python3-pytest && \
    pip install build twine pybind11 omegaconf fire numpy sphinx sphinx-rtd-theme --quiet --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Rename the existing ubuntu user/group (UID/GID 1000) to aerial
RUN usermod -l aerial ubuntu && \
    groupmod -n aerial ubuntu && \
    usermod -d /home/aerial -m aerial

# Install fixuid so the container user matches the host user (avoids "I have no name!" and file permission issues)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -SsL https://github.com/boxboat/fixuid/releases/download/v0.6.0/fixuid-0.6.0-linux-${ARCH}.tar.gz \
        | tar -C /usr/local/bin -xzf - && \
    chmod 4755 /usr/local/bin/fixuid

RUN mkdir -p /etc/fixuid && printf 'user: aerial\ngroup: aerial\n' > /etc/fixuid/config.yml

COPY container/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY client /src/client
RUN cd /src/client && cmake -Bbuild -DCMAKE_BUILD_TYPE=Release . && cmake --build build -t install

ENTRYPOINT ["/entrypoint.sh"]
