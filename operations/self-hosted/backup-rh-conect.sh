#!/usr/bin/env bash
# Back up only the RH Conect Supabase stack. The archive contains credentials.
set -Eeuo pipefail
umask 077
root=/data/rh-conect-backups
config=/data/rh-conect-supabase
database=db-2crtcbnuzdqena1tn3jwb9sy
mkdir -p "$root"
chmod 700 "$root"
[[ "$(readlink -f "$root")" == /data/rh-conect-backups ]]
[[ "$(readlink -f "$config")" == /data/rh-conect-supabase ]]
exec 9>"$root/backup.lock"
flock -n 9 || exit 0
[[ "$(docker inspect -f '{{.State.Running}}' "$database")" == true ]]
available=$(df -Pm "$root" | awk 'NR==2 {print $4}')
(( available >= 4096 )) || { echo 'BACKUP_INSUFFICIENT_FREE_SPACE'; exit 1; }
work=$(mktemp -d "$root/.rh-conect-work.XXXXXXXX")
case "$(readlink -f "$work")" in "$root"/.rh-conect-work.*) ;; *) exit 1;; esac
trap 'rm -rf -- "$work"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$root/rh-conect-$stamp.tar.gz"
docker exec "$database" pg_dump -U supabase_admin -d postgres -Fc -Z6 > "$work/database.dump"
docker exec "$database" pg_dump -U supabase_admin -d _supabase -Fc -Z6 > "$work/platform.dump"
docker exec "$database" pg_dumpall -U supabase_admin --roles-only > "$work/roles.sql"
docker exec -i "$database" pg_restore --list < "$work/database.dump" > "$work/database-toc.txt"
docker exec -i "$database" pg_restore --list < "$work/platform.dump" > "$work/platform-toc.txt"
tar -czf "$archive.partial" --exclude='./volumes/db/data' --exclude='./volumes/functions/.cache' -C "$work" database.dump platform.dump roles.sql database-toc.txt platform-toc.txt -C "$config" .
tar -tzf "$archive.partial" >/dev/null
mv "$archive.partial" "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"
# Retain 14 days; prune only completed archives after a verified replacement exists.
find "$root" -maxdepth 1 -type f -name 'rh-conect-*.tar.gz' -mtime +14 -delete
find "$root" -maxdepth 1 -type f -name 'rh-conect-*.tar.gz.sha256' -mtime +14 -delete
printf 'BACKUP_OK %s %s\n' "$stamp" "$(stat -c %s "$archive")"
