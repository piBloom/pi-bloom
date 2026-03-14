# Bloom OS — build, test, and deploy

image := env("BLOOM_IMAGE", "localhost/bloom-os:latest")
output := "core/os/output"
bib := "quay.io/centos-bootc/bootc-image-builder:latest"
bib_config := "core/os/disk_config/bib-config.toml"
podman := env("BLOOM_PODMAN", "sudo podman")
storage := env("BLOOM_STORAGE", "/var/lib/containers/storage")
ovmf := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"
registry := env("BLOOM_REGISTRY", "ghcr.io/pibloom")
remote_image := registry + "/bloom-os:latest"

# Build the container image (rootful by default, so BIB can see it)
build:
	{{ podman }} build -f core/os/Containerfile -t {{ image }} .

# Generate qcow2 disk image via bootc-image-builder
qcow2: build _require-bib-config
	mkdir -p {{ output }}
	{{ podman }} run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./{{ bib_config }}:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v {{ storage }}:/var/lib/containers/storage \
		{{ bib }} \
		--type qcow2 --local {{ image }}
	# bootc-image-builder may leave host files owned by nobody:nobody
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# Generate anaconda-iso installer via bootc-image-builder
iso: build _require-bib-config
	mkdir -p {{ output }}
	{{ podman }} run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./{{ bib_config }}:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v {{ storage }}:/var/lib/containers/storage \
		{{ bib }} \
		--type anaconda-iso --local {{ image }}
	# bootc-image-builder may leave host files owned by nobody:nobody
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# Boot qcow2 in QEMU headless (serial console + SSH on :2222)
vm:
	qemu-system-x86_64 \
		-machine q35 \
		-cpu host \
		-enable-kvm \
		-m 12G \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
		-drive if=pflash,format=raw,snapshot=on,file={{ ovmf_vars }} \
		-drive file={{ output }}/qcow2/disk.qcow2,format=qcow2,if=virtio \
		-netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
		-device virtio-net-pci,netdev=net0 \
		-nographic \
		-serial mon:stdio

# Boot qcow2 in QEMU with graphical display (SSH on :2222)
vm-gui:
	qemu-system-x86_64 \
		-machine q35 \
		-cpu host \
		-enable-kvm \
		-m 12G \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
		-drive if=pflash,format=raw,snapshot=on,file={{ ovmf_vars }} \
		-drive file={{ output }}/qcow2/disk.qcow2,format=qcow2,if=virtio \
		-netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::5000-:5000,hostfwd=tcp::8080-:8080,hostfwd=tcp::8081-:8081,hostfwd=tcp::8888-:80 \
		-device virtio-net-pci,netdev=net0 \
		-device virtio-vga-gl \
		-display gtk,gl=on

# SSH into the running VM
vm-ssh:
	ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost

# Kill the running QEMU VM
vm-kill:
	pkill -f "[q]emu-system-x86_64.*disk.qcow2" || true

# Remove generated images
clean:
	rm -rf {{ output }}

# Generate production ISO (after install, run: sudo bootc switch <registry-image> for OTA)
iso-production: build _require-bib-config
	mkdir -p {{ output }}
	{{ podman }} run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./{{ bib_config }}:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v {{ storage }}:/var/lib/containers/storage \
		{{ bib }} \
		--type anaconda-iso {{ image }}
	# bootc-image-builder may leave host files owned by nobody:nobody
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# Install host dependencies
deps:
	sudo dnf install -y just podman qemu-system-x86 edk2-ovmf

# Lint OS build scripts with shellcheck
lint-os:
	shellcheck core/os/build_files/*.sh core/os/packages/repos.sh

# Guard: ensure bib-config.toml exists before image generation
_require-bib-config:
	@test -f {{ bib_config }} || (echo "Error: {{ bib_config }} not found. Copy core/os/disk_config/bib-config.example.toml to {{ bib_config }} and set your password." && exit 1)
