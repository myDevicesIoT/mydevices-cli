#!/bin/bash
#
# myDevices CLI Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mydevices/mydevices-cli/main/install.sh | bash
#
# Options:
#   VERSION=v1.1.0 curl -fsSL ... | bash    # Install specific version
#   INSTALL_DIR=~/.local/bin curl -fsSL ... | bash  # Custom install directory
#

set -e

# Configuration
REPO="mydevices/mydevices-cli"
BINARY_NAME="mydevices"
DEFAULT_INSTALL_DIR="/usr/local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    echo -e "${BLUE}==>${NC} $1"
}

success() {
    echo -e "${GREEN}==>${NC} $1"
}

warn() {
    echo -e "${YELLOW}==>${NC} $1"
}

error() {
    echo -e "${RED}==>${NC} $1"
    exit 1
}

# Detect OS
detect_os() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$os" in
        darwin)
            echo "darwin"
            ;;
        linux)
            echo "linux"
            ;;
        mingw*|msys*|cygwin*)
            echo "windows"
            ;;
        *)
            error "Unsupported operating system: $os"
            ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64|amd64)
            echo "x64"
            ;;
        arm64|aarch64)
            echo "arm64"
            ;;
        *)
            error "Unsupported architecture: $arch"
            ;;
    esac
}

# Get latest version from GitHub
get_latest_version() {
    local latest
    latest=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$latest" ]; then
        error "Failed to fetch latest version"
    fi
    echo "$latest"
}

# Main installation
main() {
    echo ""
    echo "  ┌─────────────────────────────────────┐"
    echo "  │     myDevices CLI Installer         │"
    echo "  └─────────────────────────────────────┘"
    echo ""

    # Detect platform
    local os arch
    os=$(detect_os)
    arch=$(detect_arch)
    info "Detected platform: ${os}-${arch}"

    # Get version
    local version
    if [ -n "$VERSION" ]; then
        version="$VERSION"
        info "Installing version: $version"
    else
        info "Fetching latest version..."
        version=$(get_latest_version)
        info "Latest version: $version"
    fi

    # Determine install directory
    local install_dir
    install_dir="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

    # Check if we need sudo
    local use_sudo=""
    if [ ! -w "$install_dir" ]; then
        if [ "$install_dir" = "$DEFAULT_INSTALL_DIR" ]; then
            use_sudo="sudo"
            warn "Installation to $install_dir requires sudo"
        else
            error "Cannot write to $install_dir"
        fi
    fi

    # Build download URL
    local binary_suffix=""
    if [ "$os" = "windows" ]; then
        binary_suffix=".exe"
    fi

    local binary_filename="${BINARY_NAME}-${os}-${arch}${binary_suffix}"
    local download_url="https://github.com/${REPO}/releases/download/${version}/${binary_filename}"

    # Create temp directory
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT

    # Download binary
    info "Downloading ${binary_filename}..."
    if ! curl -fsSL "$download_url" -o "${tmp_dir}/${BINARY_NAME}"; then
        error "Failed to download from $download_url"
    fi

    # Make executable
    chmod +x "${tmp_dir}/${BINARY_NAME}"

    # Verify binary works
    info "Verifying binary..."
    if ! "${tmp_dir}/${BINARY_NAME}" --version > /dev/null 2>&1; then
        # Try running it anyway, some binaries don't support --version
        if ! "${tmp_dir}/${BINARY_NAME}" --help > /dev/null 2>&1; then
            error "Downloaded binary is not executable or is corrupted"
        fi
    fi

    # Install
    info "Installing to ${install_dir}/${BINARY_NAME}..."
    $use_sudo mkdir -p "$install_dir"
    $use_sudo mv "${tmp_dir}/${BINARY_NAME}" "${install_dir}/${BINARY_NAME}"

    # Verify installation
    if command -v "$BINARY_NAME" &> /dev/null; then
        success "Successfully installed mydevices CLI!"
        echo ""
        echo "  Run 'mydevices --help' to get started"
        echo "  Run 'mydevices auth login' to authenticate"
        echo ""
    else
        success "Installed to ${install_dir}/${BINARY_NAME}"
        echo ""
        warn "Note: ${install_dir} is not in your PATH"
        echo ""
        echo "  Add it to your PATH by running:"
        echo "    export PATH=\"${install_dir}:\$PATH\""
        echo ""
        echo "  Or add this line to your ~/.bashrc or ~/.zshrc"
        echo ""
    fi

    # Shell completion hint
    echo "  For shell completions, run:"
    echo "    eval \"\$(mydevices completion bash)\"  # bash"
    echo "    eval \"\$(mydevices completion zsh)\"   # zsh"
    echo "    mydevices completion fish > ~/.config/fish/completions/mydevices.fish  # fish"
    echo ""
}

main "$@"
