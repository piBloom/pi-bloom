# Bloom OS — build, test, and deploy

image := "bloom-os:latest"
output := "os/output"
bib := "quay.io/centos-bootc/bootc-image-builder:latest"
ovmf := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"

# Build the container image
build:
	podman build -f os/Containerfile -t {{ image }} .

# Generate qcow2 disk image via bootc-image-builder
qcow2: build
	mkdir -p {{ output }}
	sudo podman run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./os/bib-config.toml:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v /var/lib/containers/storage:/var/lib/containers/storage \
		{{ bib }} \
		--type qcow2 --local {{ image }}

# Generate anaconda-iso installer via bootc-image-builder
iso: build
	mkdir -p {{ output }}
	sudo podman run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./os/bib-config.toml:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v /var/lib/containers/storage:/var/lib/containers/storage \
		{{ bib }} \
		--type anaconda-iso --local {{ image }}

# Boot qcow2 in QEMU (graphical + SSH on port 2222)
vm:
	qemu-system-x86_64 \
		-machine q35 \
		-cpu host \
		-enable-kvm \
		-m 4G \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
		-drive if=pflash,format=raw,snapshot=on,file={{ ovmf_vars }} \
		-drive file={{ output }}/qcow2/disk.qcow2,format=qcow2,if=virtio \
		-netdev user,id=net0,hostfwd=tcp::2222-:22 \
		-device virtio-net-pci,netdev=net0 \
		-display gtk

# Boot qcow2 in QEMU serial-only mode (no GUI)
vm-serial:
	qemu-system-x86_64 \
		-machine q35 \
		-cpu host \
		-enable-kvm \
		-m 4G \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file={{ ovmf }} \
		-drive if=pflash,format=raw,snapshot=on,file={{ ovmf_vars }} \
		-drive file={{ output }}/qcow2/disk.qcow2,format=qcow2,if=virtio \
		-netdev user,id=net0,hostfwd=tcp::2222-:22 \
		-device virtio-net-pci,netdev=net0 \
		-nographic \
		-serial mon:stdio

# SSH into the running VM
vm-ssh:
	ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 bloom@localhost

# Kill the running QEMU VM
vm-kill:
	pkill -f "qemu-system-x86_64.*disk.qcow2" || true

# Remove generated images
clean:
	rm -rf {{ output }}

# Install host dependencies
deps:
	sudo dnf install -y just qemu-system-x86 edk2-ovmf
