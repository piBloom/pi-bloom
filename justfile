# Bloom OS — build, test, and deploy

image := env("BLOOM_IMAGE", "localhost/bloom-os:latest")
output := "os/output"
bib := "quay.io/centos-bootc/bootc-image-builder:latest"
bib_config := "os/bib-config.toml"
podman := env("BLOOM_PODMAN", "sudo podman")
storage := env("BLOOM_STORAGE", "/var/lib/containers/storage")
ovmf := "/usr/share/edk2/ovmf/OVMF_CODE.fd"
ovmf_vars := "/usr/share/edk2/ovmf/OVMF_VARS.fd"
registry := env("BLOOM_REGISTRY", "ghcr.io/alexradunet")
remote_image := registry + "/bloom-os:latest"

# Build the container image (rootful by default, so BIB can see it)
build:
	{{ podman }} build -f os/Containerfile -t {{ image }} .

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
	pkill -f "[q]emu-system-x86_64.*disk.qcow2" || true

# Remove generated images
clean:
	rm -rf {{ output }}

# Push built image to GHCR
push-ghcr: build
	{{ podman }} tag {{ image }} {{ remote_image }}
	{{ podman }} push {{ remote_image }}

# Generate ISO with GHCR target-imgref for OTA updates
iso-production: build _require-bib-config
	mkdir -p {{ output }}
	{{ podman }} run --rm -it --privileged --pull=newer \
		--security-opt label=type:unconfined_t \
		-v ./{{ bib_config }}:/config.toml:ro \
		-v ./{{ output }}:/output \
		-v {{ storage }}:/var/lib/containers/storage \
		{{ bib }} \
		--type anaconda-iso --target-imgref {{ remote_image }} --local {{ image }}
	# bootc-image-builder may leave host files owned by nobody:nobody
	sudo chown -R $(id -u):$(id -g) {{ output }} || true

# Push a service package as OCI artifact
svc-push name:
	cd services/{{ name }} && oras push {{ registry }}/bloom-svc-{{ name }}:latest \
		--annotation "org.opencontainers.image.title=bloom-{{ name }}" \
		--annotation "org.opencontainers.image.source=https://github.com/alexradunet/bloom" \
		$(find quadlet -type f | sed 's|.*|&:application/vnd.bloom.quadlet|') \
		SKILL.md:text/markdown

# Pull and install a service package locally (for testing)
svc-install name:
	mkdir -p /tmp/bloom-svc-{{ name }}
	oras pull {{ registry }}/bloom-svc-{{ name }}:latest -o /tmp/bloom-svc-{{ name }}/
	cp /tmp/bloom-svc-{{ name }}/quadlet/* ~/.config/containers/systemd/
	@if [ ! -f ~/.config/containers/systemd/bloom.network ]; then cp os/sysconfig/bloom.network ~/.config/containers/systemd/bloom.network; fi
	mkdir -p ~/Garden/Bloom/Skills/{{ name }}
	cp /tmp/bloom-svc-{{ name }}/SKILL.md ~/Garden/Bloom/Skills/{{ name }}/SKILL.md
	mkdir -p ~/.config/bloom/channel-tokens
	@test -f ~/.config/bloom/channel-tokens/{{ name }} || (openssl rand -hex 32 > ~/.config/bloom/channel-tokens/{{ name }} && echo "BLOOM_CHANNEL_TOKEN=$(cat ~/.config/bloom/channel-tokens/{{ name }})" > ~/.config/bloom/channel-tokens/{{ name }}.env && echo "Generated channel token for {{ name }}")
	systemctl --user daemon-reload
	@if [ -f ~/.config/containers/systemd/bloom-{{ name }}.socket ]; then \
		systemctl --user enable --now bloom-{{ name }}.socket; \
	else \
		systemctl --user enable --now bloom-{{ name }}; \
	fi
	rm -rf /tmp/bloom-svc-{{ name }}

# Install host dependencies
deps:
	sudo dnf install -y just podman qemu-system-x86 edk2-ovmf

# Guard: ensure bib-config.toml exists before image generation
_require-bib-config:
	@test -f {{ bib_config }} || (echo "Error: {{ bib_config }} not found. Copy os/bib-config.toml.example and add your SSH key." && exit 1)
