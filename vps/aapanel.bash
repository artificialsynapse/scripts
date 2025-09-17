#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIG ======
AAPANEL_USER="admin"
AAPANEL_PASS="Senha@2025"
# ====================

LOG="/root/bootstrap-aapanel.log"
exec > >(tee -a "$LOG") 2>&1
export DEBIAN_FRONTEND=noninteractive

echo "=== [$(date -Is)] Bootstrap start ==="

# 1) Timezone/locale
timedatectl set-timezone America/Sao_Paulo || true
apt-get update -y
apt-get install -y locales
sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
locale-gen && update-locale LANG=en_US.UTF-8
export LANG=en_US.UTF-8

# 2) Upgrade + deps
apt-get upgrade -y
apt-get dist-upgrade -y
apt-get install -y --no-install-recommends \
  ca-certificates curl wget git unzip zip gnupg lsb-release \
  software-properties-common apt-transport-https \
  build-essential ufw fail2ban htop jq net-tools

# 3) Swap 2G (se não existir)
if ! swapon --show | grep -q '^'; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# 4) Firewall básico
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8888/tcp   # aaPanel default
echo "y" | ufw enable || true
ufw status || true

# 5) Instalação do aaPanel (idempotente)
AAPANEL_DIR="/www/server/panel"
if [ -d "$AAPANEL_DIR" ]; then
  echo "aaPanel já instalado em $AAPANEL_DIR – pulando instalação."
else
  mkdir -p /root/aapanel_install && cd /root/aapanel_install
  # script oficial; tenta mirror se primário falhar
  if ! wget -O install.sh http://www.aapanel.com/script/install-ubuntu_6.0_en.sh; then
    wget -O install.sh https://download.bt.cn/install/install-ubuntu_6.0_en.sh
  fi
  chmod +x install.sh
  # modo não-interativo
  bash install.sh << 'EOF'
y
EOF
fi

# 6) Fixar credenciais do aaPanel (bt 6 = user, bt 5 = password)
if command -v bt >/dev/null 2>&1; then
  printf '%s\n' "$AAPANEL_USER" | bt 6 || true
  printf '%s\n' "$AAPANEL_PASS" | bt 5 || true
  bt 14 || true  # imprime info básica no log
else
  echo "Comando 'bt' não encontrado – verifique instalação do aaPanel." >&2
fi

# 7) SSH: permitir senha (se precisar), proibir root por senha
sed -ri 's/^#?PasswordAuthentication\s+.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -ri 's/^#?PermitRootLogin\s+.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
(systemctl restart ssh || systemctl restart sshd) || true

# 8) Unattended upgrades
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# 9) Limpeza
apt-get autoremove -y && apt-get clean

# 10) Info útil
INFO_OUT="/root/aapanel-info.txt"
{
  echo "=== aaPanel info ($(date -Is)) ==="
  [ -f /root/.bt_setupInfo ] && cat /root/.bt_setupInfo || true
  echo "URL (padrão): http://$(hostname -I | awk '{print $1}'):8888/"
  echo "Usuário: ${AAPANEL_USER}"
  echo "Senha:  ${AAPANEL_PASS}"
  echo "Log: ${LOG}"
} | tee "$INFO_OUT"

echo "=== [$(date -Is)] Bootstrap finished ==="