deploy:
	@echo "rsync -avz --delete ./public $(DEPLOY_PUBLIC_PATH)"
	@sshpass -p "$(SSH_PASSWORD)" \
		rsync -avz --delete -e "ssh -p $(SSH_PORT)" --chmod=u+w  \
		--checksum ./public \
		"$(SSH_USER)@$(SSH_HOST):/$(DEPLOY_PUBLIC_PATH)"

.PHONY: deploy
