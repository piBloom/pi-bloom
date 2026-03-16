# WORKAROUND: remove this file when quay.io/centos-bootc/bootc-image-builder includes the fix for
# python3-mako missing from the lorax buildroot in the bootc-installer path.
# Upstream bug: https://github.com/osbuild/images/blob/main/pkg/manifest/anaconda_installer.go
# (getBuildPackages returns nil for bootc container path — python3-mako never injected)
# To remove: delete this file and follow the justfile WORKAROUND comment instructions.

# Stage 1: Build patched bootc-image-builder binary from source
FROM registry.fedoraproject.org/fedora:42 AS builder
RUN dnf install -y golang git && dnf clean all

WORKDIR /src

# Pin to the exact BIB commit that matches quay.io/centos-bootc/bootc-image-builder:latest
# (build_revision: ee18461, build_time: 2026-03-06T14:38:01Z)
ARG BIB_COMMIT=ee184614c4bd00034aec1543990997da9c153315
RUN git clone https://github.com/osbuild/bootc-image-builder . && \
    git checkout ${BIB_COMMIT}

# Verify expected repo layout: the BIB repo has a bib/ subdirectory containing the Go module,
# vendor tree, and cmd/bootc-image-builder/ entrypoint.
RUN test -f bib/go.mod && \
    test -d bib/vendor/github.com/osbuild/images/pkg/manifest && \
    test -d bib/cmd/bootc-image-builder || \
    (echo "ERROR: unexpected repo layout at ${BIB_COMMIT} — update path assumptions" && exit 1)

# Note on quoting: \t and \n inside Python string literals in `python3 -c "..."` are correctly
# interpreted as tab/newline by Python's string literal parser even though the shell does not
# expand them (shell double-quotes do not expand \t). Go source uses actual tabs, which Python
# produces for \t — so the .replace() match is correct.
# Patch: getBuildPackages() returns nil for the bootc container path, which means python3-mako
# is never injected into the lorax buildroot. Return it so the lorax-script stage can import mako.
# If the upstream source structure changes, the assert will fail loudly at build time.
RUN python3 -c "
import pathlib
f = pathlib.Path('bib/vendor/github.com/osbuild/images/pkg/manifest/anaconda_installer.go')
content = f.read_text()
patched = content.replace(
    '\tif p.BootcLivefsContainer != nil {\n\t\treturn nil, nil\n\t}',
    '\tif p.BootcLivefsContainer != nil {\n\t\treturn []string{\"python3-mako\"}, nil\n\t}')
assert patched != content, 'PATCH FAILED: upstream source structure may have changed — check anaconda_installer.go getBuildPackages()'
f.write_text(patched)
print('Patch applied successfully')
"

RUN cd bib && go build -o /usr/bin/bootc-image-builder ./cmd/bootc-image-builder/

# Stage 2: Swap patched binary into the official BIB image
FROM quay.io/centos-bootc/bootc-image-builder:latest
COPY --from=builder /usr/bin/bootc-image-builder /usr/bin/bootc-image-builder
