#!/usr/bin/env bash
set -euo pipefail

# SIS Unified Installer for Ubuntu 24+
# 目的:
#  - デスクトップ(UI)配備（既存の DE-deploy.sh を活用）
#  - 端末暗号化の下地(fscrypt)とリモートワイプ
#  - アカウント集中管理(SSO/SSSD系)の下地とMDMフック
#  - ログ収集/監査(auditd, udev/NM フック)と安全な転送(任意のrsyslog/journal-remote)
#  - 更新管理(unattended-upgrades + 事前スナップショット)
#  - DNSフィルタ/通信制御(dnscrypt-proxy + nftables封じ)
#  - データ保護の既定値(umask/クラウド既定/外部媒体の制限)
#  - 授業向け: Veyon導入・試験モード(ロックダウン)の下地
#  - ゼロタッチ初期化/復旧(初回ウィザード/ファクトリリセット)
#
# 環境変数(任意):
#  SIS_NONINTERACTIVE=1  ->  対話を極力避ける
#  SIS_MDM_URL / SIS_MDM_TOKEN  -> MDMエンドポイント(ポリシー取得/レジスト)
#  SIS_LOG_REMOTE (rsyslog) or SIS_JOURNAL_UPLOAD_URL (systemd-journal-upload)
#  SIS_DNS_UPSTREAM (例: https://dns.quad9.net/dns-query) / SIS_DNS_BLOCKLIST_URL
#  SIS_CLASS_START_HHMM / SIS_CLASS_END_HHMM  -> 授業時間帯の更新回避(例: 0830/1630)
#  SIS_USE_BTRFS=1 -> btrfsスナップショット最優先

ROOT_DIR=$(cd -- "$(dirname -- "$0")"; pwd)
SUDO=""
if [[ $EUID -ne 0 ]]; then SUDO=sudo; fi

log() { echo -e "[install] $*"; }
warn() { echo -e "[install][WARN] $*" >&2; }
die() { echo -e "[install][ERROR] $*" >&2; exit 1; }

require_ubuntu24() {
	if ! command -v lsb_release >/dev/null 2>&1; then $SUDO apt-get update -y && $SUDO apt-get install -y lsb-release; fi
	local dist=$(lsb_release -is 2>/dev/null || echo Ubuntu)
	local ver=$(lsb_release -rs 2>/dev/null || echo 24)
	if [[ "$dist" != "Ubuntu" ]]; then warn "非Ubuntu環境です: $dist $ver (継続します)"; fi
	local major=${ver%%.*}
	if (( major < 24 )); then warn "Ubuntu 24+ 推奨ですが $ver を検出 (継続します)"; fi
}

usage() {
	cat <<USAGE
SIS Installer (Ubuntu 24+)
	--dry-run         実際の変更は行わず工程概要のみ表示
	--no-ui           sis-ui(デスクトップ)配備をスキップ
	--minimal         監査/MDM/フィルタ等を最小限に(開発検証向け)
	--with-veyon      Veyon(授業管理)をインストール
	--with-syncthing  Syncthing(配布/回収の土台)をインストール
	--help            このヘルプ
USAGE
}

DRY_RUN=0
DO_UI=1
MINIMAL=0
WITH_VEYON=0
WITH_SYNCTHING=0
for a in "$@"; do
	case "$a" in
		--dry-run) DRY_RUN=1;;
		--no-ui) DO_UI=0;;
		--minimal) MINIMAL=1;;
		--with-veyon) WITH_VEYON=1;;
		--with-syncthing) WITH_SYNCTHING=1;;
		-h|--help) usage; exit 0;;
		*) warn "Unknown arg: $a";;
	esac
done

if [[ $DRY_RUN -eq 1 ]]; then
	cat <<'DRY'
[dry-run] 実行プラン:
	1) 前提チェック/基本パッケージ導入
	2) 監査・ログ: auditd, udev/NM ディスパッチ、転送(任意)
	3) 更新管理: unattended-upgrades + 事前スナップショット
	4) DNSフィルタ: dnscrypt-proxy と外部DNS封じ(nftables)
	5) データ保護: umask/外部媒体を制限、(任意) fscrypt初期化
	6) MDMフック: ポリシー取得/適用の下地、証明書配布
	7) リモートワイプ: フラグ/MDM指示で安全消去
	8) 授業系: (任意) Veyon、試験モードの下地
	9) 配布回収: (任意) Syncthing 導入
 10) ゼロタッチ: 初回ブートウィザード
 11) DE配備: sis-ui (DE-deploy.sh 実行)
DRY
	exit 0
fi

require_ubuntu24

log "[1/11] 基本パッケージの導入"
$SUDO apt-get update -y
$SUDO apt-get install -y curl jq ca-certificates gnupg unzip coreutils rsyslog auditd systemd-journal-remote systemd-timesyncd
$SUDO apt-get install -y network-manager udev nftables dnsutils || true
$SUDO systemctl enable --now systemd-timesyncd.service || true

log "[2/11] /etc/sis とスクリプト配置"
$SUDO install -d -m 0755 /etc/sis /etc/sis/mdm /usr/local/sis /var/log/sis
$SUDO install -m 0644 "$ROOT_DIR/provisioning/sis.conf" /etc/sis/sis.conf || true
for f in mdm-agent.sh remote-wipe.sh profiled.sh pre-update-snapshot.sh setup-dns-filter.sh setup-fscrypt.sh zerotouch-wizard.sh exam-mode.sh screen-record.sh veyon-setup.sh distribute-collect.sh create-accounts.sh setup-sso.sh apply-wifi.sh apply-proxy.sh apply-certs.sh apply-printers.sh apply-restrictions.sh inventory.sh remote-support.sh factory-reset.sh; do
	$SUDO install -m 0755 "$ROOT_DIR/scripts/$f" "/usr/local/sis/$f"
done

log "[3/11] 監査/ログフックの配置"
$SUDO install -d -m 0755 /etc/audit/rules.d
$SUDO install -m 0644 "$ROOT_DIR/provisioning/audit/99-sis.rules" /etc/audit/rules.d/99-sis.rules
$SUDO systemctl enable --now auditd.service || true

# NM ディスパッチャ
$SUDO install -d -m 0755 /etc/NetworkManager/dispatcher.d
$SUDO install -m 0755 "$ROOT_DIR/provisioning/nm-dispatcher/90-sis-log" /etc/NetworkManager/dispatcher.d/90-sis-log

# USB udev ルール
$SUDO install -d -m 0755 /etc/udev/rules.d
$SUDO install -m 0644 "$ROOT_DIR/provisioning/udev/99-sis-usb.rules" /etc/udev/rules.d/99-sis-usb.rules
$SUDO udevadm control --reload || true

# Polkit 権限（教師が端末管理操作を可能に）
if [[ -d /etc/polkit-1/localauthority/50-local.d ]]; then
	$SUDO install -m 0644 "$ROOT_DIR/provisioning/polkit/90-sis-teacher.pkla" /etc/polkit-1/localauthority/50-local.d/90-sis-teacher.pkla
fi

# リモート転送(任意): rsyslog or journal-upload
if [[ -n "${SIS_LOG_REMOTE:-}" ]]; then
	log "- rsyslog をリモート($SIS_LOG_REMOTE)へ転送するよう設定 (簡易)"
	$SUDO bash -lc 'echo "*.* @@${SIS_LOG_REMOTE}" > /etc/rsyslog.d/99-sis-remote.conf'
	$SUDO systemctl restart rsyslog || true
fi
if [[ -n "${SIS_JOURNAL_UPLOAD_URL:-}" ]]; then
	log "- systemd-journal-upload を設定($SIS_JOURNAL_UPLOAD_URL)"
	$SUDO bash -lc 'cat > /etc/systemd/journal-upload.conf <<CONF
[Upload]
URL=${SIS_JOURNAL_UPLOAD_URL}
ServerKeyFile=/etc/ssl/private/journal-upload.pem
ServerCertificateFile=/etc/ssl/certs/journal-upload.crt
TrustedCertificateFile=/etc/ssl/certs/ca-certificates.crt
CONF'
	$SUDO systemctl enable --now systemd-journal-upload.service || true
fi

log "[4/11] 更新管理(unattended-upgrades + 事前スナップショット)"
$SUDO apt-get install -y unattended-upgrades apt-listchanges timeshift || true
# タイマーの活性化
$SUDO dpkg-reconfigure -f noninteractive unattended-upgrades || true
# APT 既定値の強化(自動再起動時刻/ダウンロード)
for f in 20auto-upgrades 99sis-proxy.conf; do
	[[ -f "$ROOT_DIR/provisioning/apt/$f" ]] && $SUDO install -m 0644 "$ROOT_DIR/provisioning/apt/$f" "/etc/apt/apt.conf.d/$f" || true
done
# 事前スナップショット + アップデート実行の systemd
for u in sis-preupgrade.service sis-preupgrade.timer sis-upgrade.service sis-upgrade.timer; do
	$SUDO install -m 0644 "$ROOT_DIR/provisioning/systemd/$u" "/etc/systemd/system/$u"
done
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now sis-preupgrade.timer sis-upgrade.timer || true

log "[5/11] DNS フィルタ/通信制御の初期設定"
/usr/local/sis/setup-dns-filter.sh || true

log "[6/11] データ保護の既定値(umask/外部媒体)"
# 厳格なumask
echo 'umask 077' | $SUDO tee /etc/profile.d/zz-sis-umask.sh >/dev/null
$SUDO chmod 0644 /etc/profile.d/zz-sis-umask.sh
# udisks2経由の外部媒体に nosuid,nodev,noexec を推奨(ベストエフォート)
if [[ -d /etc/udev/rules.d ]]; then
	$SUDO bash -lc 'cat > /etc/udev/rules.d/99-sis-external-media.rules <<R
ENV{ID_FS_USAGE}=="filesystem", ENV{UDISKS_MOUNT_OPTIONS_DEFAULTS}="nosuid,nodev,noexec"
R'
	$SUDO udevadm control --reload || true
fi
# (任意) fscrypt 初期化(土台のみ)
/usr/local/sis/setup-fscrypt.sh || true

log "[7/11] MDM フックとリモートワイプの設定"
for u in sis-mdm-agent.service sis-mdm-agent.timer sis-remote-wipe.path sis-remote-wipe.service; do
	$SUDO install -m 0644 "$ROOT_DIR/provisioning/systemd/$u" "/etc/systemd/system/$u"
done
$SUDO install -m 0644 "$ROOT_DIR/provisioning/systemd/sis-agent-update.service" /etc/systemd/system/sis-agent-update.service
$SUDO install -m 0644 "$ROOT_DIR/provisioning/systemd/sis-agent-update.timer" /etc/systemd/system/sis-agent-update.timer
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now sis-mdm-agent.timer sis-remote-wipe.path sis-agent-update.timer || true

log "[8/11] 授業系 (Veyon/試験モード/配布回収の下地)"
if [[ $WITH_VEYON -eq 1 ]]; then
	$SUDO apt-get install -y veyon || warn "veyon のインストールに失敗(スキップ)"
fi
$SUDO install -m 0644 "$ROOT_DIR/provisioning/systemd/sis-exam-mode.service" /etc/systemd/system/sis-exam-mode.service
$SUDO systemctl daemon-reload || true
if [[ $WITH_SYNCTHING -eq 1 ]]; then
	$SUDO apt-get install -y syncthing || warn "syncthing のインストールに失敗(スキップ)"
fi

log "[9/11] ゼロタッチ初期化(初回ウィザード)"
$SUDO install -m 0644 "$ROOT_DIR/provisioning/systemd/sis-zerotouch.service" /etc/systemd/system/sis-zerotouch.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable sis-zerotouch.service || true

log "[10/11] sis-ui(デスクトップ)の配備"
if [[ $DO_UI -eq 1 ]]; then
	[[ -x "$ROOT_DIR/DE-deploy.sh" ]] || die "DE-deploy.sh not found"
	"$ROOT_DIR/DE-deploy.sh"
else
	log "- DE 配備は --no-ui によりスキップ"
fi

log "[11/11] クリーンアップ・最終調整"
$SUDO systemctl restart rsyslog || true
$SUDO /usr/local/sis/create-accounts.sh || true
$SUDO /usr/local/sis/setup-sso.sh || true
log "完了: 再起動後に各種ポリシー/フィルタ/監査が有効になります。"
log "MDM へ登録: /usr/local/sis/mdm-agent.sh enroll を参照。"

exit 0

