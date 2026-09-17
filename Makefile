# auto-pi server control.
#
# The ESP32 `/api/esp-status` endpoint is served by the UI backend API
# (`node ui/server/server.js`, port 8787, systemd unit `auto-pi-ui.service`).
# Loop progress logging is written by the autonomous loop (`scripts/loop.js`
# detached via `npm run resume` / `npm run restart`).
#
#   make server-start    # start API + resume loop (idempotent)
#   make server-restart  # restart API + restart loop
#
# See docs/ui.md (ESP32 / LAN polling) and docs/troubleshooting.md
# (`curl /api/esp-status` hangs or refuses to connect).

SERVICE := auto-pi-ui.service
UNIT_SRC := systemd/auto-pi-ui.service
UNIT_DST := $(HOME)/.config/systemd/user/$(SERVICE)
PORT ?= 8787

.PHONY: help server-start server-restart

help:
	@echo "Targets:"
	@echo "  make server-start    # start API (systemd) + resume loop (logging)"
	@echo "  make server-restart  # restart API (systemd) + restart loop (logging)"

# Install the user unit on first use only — never overwrite an installed
# unit, so a local HOST=0.0.0.0 LAN override is preserved.
$(UNIT_DST):
	mkdir -p $(dir $(UNIT_DST))
	cp $(UNIT_SRC) $(UNIT_DST)
	systemctl --user daemon-reload

server-start: $(UNIT_DST)
	systemctl --user enable --now $(SERVICE)
	npm run resume
	systemctl --user is-active $(SERVICE)
	curl -sf http://127.0.0.1:$(PORT)/api/healthz
	npm run status

server-restart: $(UNIT_DST)
	systemctl --user restart $(SERVICE)
	npm run restart
	systemctl --user is-active $(SERVICE)
	curl -sf http://127.0.0.1:$(PORT)/api/healthz
	npm run status
