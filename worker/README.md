# Worker

This directory starts the AODT Digital Twin server (worker) using Docker Compose.
The `client/` directory in this repo contains the client library used to connect to it.

## Prerequisites

- A Linux machine with an NVIDIA GPU
- Docker with the NVIDIA Container Toolkit (see below)
- Docker Compose v2 (CLI plugin) ≥ 2.3 — the legacy standalone `docker-compose` v1 is not supported

### Docker

```bash
# Install Docker from the official repository (includes docker-compose-plugin)
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo mkdir -p /etc/apt/sources.list.d
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER  # allow running docker without sudo (re-login required)
```

### NVIDIA Container Toolkit

Required for GPU access in containers:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

## Starting the server

```bash
./worker/up.sh
```

This detects the machine IP automatically, then brings up the worker and its infrastructure services (ClickHouse, MinIO, Nessie).

## Stopping the server

```bash
docker compose -f worker/docker-compose.yml down
```
