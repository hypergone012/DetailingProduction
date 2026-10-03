# Восстановление сервера из резервной копии

Каждую ночь `dp-backup.timer` кладёт в `/var/backups/dp`:

- `db-ГГГГММДД-ЧЧММСС.dump` — вся база: записи, клиенты, аккаунты владельцев, настройки студий;
- `files-ГГГГММДД-ЧЧММСС.tar.gz` — загруженные фото и логотипы;
- `secrets.env` — секреты сервера. Без них старые ссылки на записи, push-уведомления и входы перестанут работать.

Копии хранятся 7 дней (`DP_BACKUP_KEEP_DAYS`). Если сервер пропадёт, пропадут и они, поэтому хотя бы раз в неделю скачивайте папку к себе:

```bash
scp -r root@IP_СЕРВЕРА:/var/backups/dp ./dp-backup-$(date +%F)
```

Храните её как пароль: в ней персональные данные клиентов и ключи.

## Сделать копию прямо сейчас

```bash
systemctl start dp-backup.service && ls -lh /var/backups/dp
```

## Восстановить на этом же или на новом сервере

1. **Новый сервер.** Запустите **Deploy server (Russia)** на новый сервер, чтобы он установился. Затем выполните шаги 2–5 по SSH под root.
2. **Вернуть секреты.** Положите сохранённый `secrets.env` в `/etc/dp/secrets.env` (права 600) и пересоберите настройки:

   ```bash
   install -m 600 secrets.env /etc/dp/secrets.env
   /opt/dp/platform/current/bin/deno run --no-prompt --allow-read=/etc/dp --allow-write=/etc/dp /opt/dp/app/current/server/configure.ts /etc/dp
   ```

3. **Остановить сервисы:**

   ```bash
   systemctl stop dp-caddy dp-gateway dp-storage dp-rest dp-auth dp-dispatch.timer
   ```

4. **Вернуть базу и файлы:**

   ```bash
   runuser -u postgres -- pg_restore --clean --if-exists -d dp db-ГГГГММДД-ЧЧММСС.dump
   rm -rf /var/lib/dp/storage && tar -xzf files-ГГГГММДД-ЧЧММСС.tar.gz -C /var/lib/dp && chown -R dp:dp /var/lib/dp/storage
   ```

5. **Запустить заново.** Снова запустите **Deploy server (Russia)**. Он вернёт пароли ролей базы из `secrets.env`, запустит сервисы и проверит сайт.
