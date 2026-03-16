# Bloom OS — build, test, and deploy

image := env("BLOOM_IMAGE", "localhost/bloom-os:latest")
output := "core/os/output"
bib := "quay.io/centos-bootc/bootc-image-builder:latest"  # official osbuild BIB image (built on Fedora, centos-bootc is just the org name)
# WORKAROUND: bib_patched and build-bib exist because bootc-installer is broken in the official BIB
# image — python3-mako is missing from the lorax buildroot (getBuildPackages returns nil for the
# bootc container path). Track: https://github.com/osbuild/images/blob/main/pkg/manifest/anaconda_installer.go
# To remove when upstream ships the fix:
#   1. Delete core/os/bib.Containerfile
#   2. Delete this variable and the build-bib recipe
#   3. Revert iso recipe to exactly:
#        iso: build _require-bib-config
#            mkdir -p {{ output }}
#            {{ podman }} run --rm -it --privileged --pull=newer \
#                --security-opt label=type:unconfined_t \
#                -v ./{{ bib_config }}:/config.toml:ro \
#                -v ./{{ output }}:/output \
#                -v {{ storage }}:/var/lib/containers/storage \
#                {{ bib }} \
#                --type bootc-installer --installer-payload-ref {{ image }} {{ image }}
#            sudo chown -R $(id -u):$(id -g) {{ output }} || true
# To force a rebuild of the patched image: {{ podman }} rmi localhost/bib-patched:latest && just build-bib
bib_patched := "localhost/bib-patched:latest"
bib_config := "core/os/disk_config/bib-config.toml"
podman := env("BLOOM_PODMAN", "sudo podman")
storage := env("BLOOM_STORAGE", "/var/lib/containers/storage")
ovmf := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"
registry := env("BLOOM_REGISTRY", "ghcr.io/alexradunet")
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
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# Generate raw disk image for offline/direct flashing (dd to target disk, no installer needed)
raw: build _require-bib-config
	mkdir -p {{ output }}
	{{ podman }} run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./{{ bib_config }}:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v {{ storage }}:/var/lib/containers/storage \
		{{ bib }} \
		--type raw --local {{ image }}
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# WORKAROUND: builds patched BIB image — see bib_patched comment above
build-bib:
	#!/usr/bin/env bash
	set -euo pipefail
	if {{ podman }} image exists {{ bib_patched }}; then
		echo "Patched BIB image already present, skipping build"
	else
		{{ podman }} build -f core/os/bib.Containerfile -t {{ bib_patched }} .
	fi

# Generate installer ISO via bootc-image-builder (offline, self-contained)
# WORKAROUND: depends on build-bib and uses bib_patched instead of bib — see bib_patched comment above
iso: build _require-bib-config build-bib
	mkdir -p {{ output }}
	{{ podman }} run --rm -it --privileged --pull=never \
		--security-opt label=type:unconfined_t \
		-v ./{{ bib_config }}:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v {{ storage }}:/var/lib/containers/storage \
		{{ bib_patched }} \
		--type bootc-installer --installer-payload-ref {{ image }} {{ image }}
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# Test ISO installation in QEMU (creates a temporary disk, boots ISO installer)
test-iso:
	#!/usr/bin/env bash
	set -euo pipefail
	disk="/tmp/bloom-test-disk.qcow2"
	vars="/tmp/bloom-ovmf-vars.fd"
	if [ ! -f "{{ output }}/bootiso/install.iso" ]; then
		echo "Error: No ISO found. Run 'just iso' first."
		exit 1
	fi
	rm -f "$disk" "$vars"
	qemu-img create -f qcow2 "$disk" 40G
	cp "{{ ovmf_vars }}" "$vars"
	echo "Starting ISO installation test..."
	echo "Press Ctrl+A X to exit QEMU"
	qemu-system-x86_64 \
		-machine q35 \
		-cpu host \
		-enable-kvm \
		-m 8G \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
		-drive if=pflash,format=raw,file="$vars" \
		-drive file="$disk",format=qcow2,if=virtio \
		-cdrom {{ output }}/bootiso/install.iso \
		-netdev user,id=net0,hostfwd=tcp::2222-:22 \
		-device virtio-net-pci,netdev=net0 \
		-nographic \
		-serial mon:stdio

# Test ISO installation in QEMU with graphical display
test-iso-gui:
	#!/usr/bin/env bash
	set -euo pipefail
	disk="/tmp/bloom-test-disk.qcow2"
	vars="/tmp/bloom-ovmf-vars.fd"
	if [ ! -f "{{ output }}/bootiso/install.iso" ]; then
		echo "Error: No ISO found. Run 'just iso' first."
		exit 1
	fi
	rm -f "$disk" "$vars"
	qemu-img create -f qcow2 "$disk" 40G
	cp "{{ ovmf_vars }}" "$vars"
	echo "Starting ISO installation test (GUI)..."
	qemu-system-x86_64 \
		-machine q35 \
		-cpu host \
		-enable-kvm \
		-m 8G \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
		-drive if=pflash,format=raw,file="$vars" \
		-drive file="$disk",format=qcow2,if=virtio \
		-cdrom {{ output }}/bootiso/install.iso \
		-netdev user,id=net0,hostfwd=tcp::2222-:22 \
		-device virtio-net-pci,netdev=net0 \
		-device virtio-vga-gl \
		-display gtk,gl=on

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

# Install host dependencies
deps:
	sudo dnf install -y just podman qemu-system-x86 edk2-ovmf

# Lint OS build scripts with shellcheck
lint-os:
	shellcheck core/os/build_files/*.sh core/os/packages/repos.sh

# Guard: ensure bib-config.toml exists before image generation
_require-bib-config:
	@test -f {{ bib_config }} || (echo "Error: {{ bib_config }} not found. Copy core/os/disk_config/bib-config.example.toml to {{ bib_config }} and set your password." && exit 1)
