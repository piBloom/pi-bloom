# Third-party repository setup — sourced by 00-base-fetch.sh

# VS Code (Microsoft)
rpm --import https://packages.microsoft.com/keys/microsoft.asc
printf '[code]\nname=Visual Studio Code\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\nenabled=1\ngpgcheck=1\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc\n' \
    > /etc/yum.repos.d/vscode.repo

# NetBird mesh networking
printf '[netbird]\nname=netbird\nbaseurl=https://pkgs.netbird.io/yum/\nenabled=1\ngpgcheck=0\nrepo_gpgcheck=1\ngpgkey=https://pkgs.netbird.io/yum/repodata/repomd.xml.key\n' \
    > /etc/yum.repos.d/netbird.repo
