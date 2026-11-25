echo '===NET_START==='; ss -tulpnH 2>/dev/null || netstat -tulpn 2>/dev/null; echo '===NET_END==='
echo '===PID_DETAILS_START==='
for p in $(ss -tulpnH 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
  [ -d "/proc/$p" ] || continue
  printf '%s|%s|%s|%s|%s\n' "$p" "$(ps -o user= -p "$p" | tr -d ' ')" "$(readlink -f "/proc/$p/cwd")" "$(readlink -f "/proc/$p/exe")" "$(tr '\0' ' ' < "/proc/$p/cmdline" | head -c 500)"
done
echo '===PID_DETAILS_END==='
echo '===SYSTEMD_START==='
units=$(systemctl list-units --type=service --state=running --no-pager --no-legend --plain 2>/dev/null | awk '{print $1}')
[ -z "$units" ] || systemctl show $units --property=Id,Description,ExecStart,WorkingDirectory,FragmentPath,MainPID,ActiveState 2>/dev/null
echo '===SYSTEMD_END==='
echo '===WORKERS_START==='
ps -eo pid,user,args --no-headers | grep -E '(/var/www|/home/|/opt/|node |python |php |go |java )' | grep -v grep | head -40 | while read -r p rest; do
  [ -d "/proc/$p" ] || continue
  printf '%s|%s|%s|%s|%s\n' "$p" "$(ps -o user= -p "$p" | tr -d ' ')" "$(readlink -f "/proc/$p/cwd")" "$(readlink -f "/proc/$p/exe")" "$(tr '\0' ' ' < "/proc/$p/cmdline" | head -c 500)"
done
echo '===WORKERS_END==='
echo '===DOCKER_START==='; docker ps --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null; echo '===DOCKER_END==='
echo '===WEB_ROOTS_START==='
for d in /var/www/* /var/www/html/*; do
  [ -d "$d" ] || continue
  printf '%s|%s|%s|%s\n' "$(basename "$d")" "$d" "$(ls -1A "$d" | wc -l)" "$(stat -c %U "$d")"
done
echo '===WEB_ROOTS_END==='
