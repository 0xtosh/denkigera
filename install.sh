#!/bin/bash

# ==============================================================================
# Final Node.js & Nginx Application Setup Script (Robust Version)
#
# This script is designed to be run from within the application's main directory.
# It automates the complete setup process, including a resilient cleanup step
# and provides final instructions for user-interactive steps.
# ==============================================================================

# --- Strict Mode ---
set -euo pipefail

# --- Configuration ---
readonly APP_USER="nodeapp"
readonly APP_DIR="/var/www/app"
readonly WEB_DIR="/var/www/html"
readonly APP_FILE="denkigera.js"
readonly SERVICE_NAME="denkigera"
readonly NODE_MAJOR=20
readonly NODE_PORT=3000
readonly NVM_VERSION="v0.39.7"

# --- Global Variables ---
readonly SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
NODE_EXEC_PATH=""

# --- Pre-flight Check ---
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ This script must be run as root. Please use 'sudo'." >&2
  exit 1
fi

# --- Main Execution Function ---
main() {
  echo "🚀 Starting Node.js application setup from local files..."
  cleanup
  create_system_user
  install_dependencies
  deploy_application
  configure_nginx
  create_systemd_service
  finalize_setup
}

# --- Function Definitions ---

##
# Step 1: Clean up old installations safely
##
cleanup() {
  echo "➡️ Step 1: Cleaning up previous installations..."
  systemctl stop "$SERVICE_NAME".service &>/dev/null || true
  systemctl stop nginx.service &>/dev/null || true
  apt-get purge -y nodejs &>/dev/null || true
  rm -f /etc/apt/sources.list.d/nodesource.list
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/sites-available/"$SERVICE_NAME"
  rm -f /etc/nginx/sites-enabled/"$SERVICE_NAME"
  apt-get autoremove -y &>/dev/null || true
  echo "   - Cleanup complete."
}

##
# Step 2: Create a dedicated system user
##
create_system_user() {
  echo "➡️ Step 2: Creating system user '$APP_USER'..."
  if id "$APP_USER" &>/dev/null; then
    echo "   - User '$APP_USER' already exists. Skipping."
  else
    useradd -rm -s /bin/false "$APP_USER"
    echo "   - User '$APP_USER' created successfully."
  fi
}

##
# Step 3: Install dependencies and Node.js via NVM
##
install_dependencies() {
  echo "➡️ Step 3: Installing dependencies and Node.js via nvm..."
  apt-get update
  apt-get install -y curl nginx
  echo "   - Installing nvm for user '$APP_USER'..."
  su -s /bin/bash -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh | bash" "$APP_USER"
  echo "   - Installing Node.js v$NODE_MAJOR..."
  su -s /bin/bash -c "source /home/$APP_USER/.nvm/nvm.sh && nvm install $NODE_MAJOR" "$APP_USER"
  NODE_EXEC_PATH=$(su -s /bin/bash -c "source /home/$APP_USER/.nvm/nvm.sh && nvm which $NODE_MAJOR" "$APP_USER")
  if [ -z "$NODE_EXEC_PATH" ]; then
    echo "❌ Failed to find Node.js executable path after nvm installation." >&2
    exit 1
  fi
  echo "   - Node.js installed at: $NODE_EXEC_PATH"
}

##
# Step 4: Copy application files and install dependencies
##
deploy_application() {
  echo "➡️ Step 4: Deploying application from local directory..."
  mkdir -p "$APP_DIR" "$WEB_DIR"
  cp "$SCRIPT_DIR/$APP_FILE" "$APP_DIR"
  cp "$SCRIPT_DIR/package.json" "$APP_DIR"
  cp "$SCRIPT_DIR/token.txt" "$APP_DIR"
  echo "   - Application files copied to '$APP_DIR'."
  cp -r "$SCRIPT_DIR"/www/* "$WEB_DIR"
  echo "   - Static web files copied to '$WEB_DIR'."
  echo "   - Setting application directory permissions..."
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  echo "   - Installing npm dependencies using nvm..."
  su -s /bin/bash -c "source /home/$APP_USER/.nvm/nvm.sh && cd $APP_DIR && npm install --production" "$APP_USER"
  echo "   - Setting web directory permissions..."
  chown -R www-data:www-data "$WEB_DIR"
}

##
# Step 5: Configure Nginx to serve files and proxy the API
##
configure_nginx() {
    echo "➡️ Step 5: Configuring Nginx as a reverse proxy..."
    cat > /etc/nginx/sites-available/"$SERVICE_NAME" << EOF
server {
    listen 80;
    listen [::]:80;
    server_name _;
    root $WEB_DIR;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location /api/ {
        proxy_pass http://localhost:$NODE_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
    # Remove the link if it exists to prevent errors, then create it
    rm -f /etc/nginx/sites-enabled/"$SERVICE_NAME"
    ln -s /etc/nginx/sites-available/"$SERVICE_NAME" /etc/nginx/sites-enabled/
    nginx -t
    echo "   - Nginx configuration created and enabled."
}

##
# Step 6: Create the systemd service for the Node.js app
##
create_systemd_service() {
  echo "➡️ Step 6: Creating systemd service '$SERVICE_NAME.service'..."
  cat > /etc/systemd/system/"$SERVICE_NAME".service << EOF
[Unit]
Description=Denkigera Node.js Service ($APP_FILE)
After=network.target
[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment="PORT=$NODE_PORT"
ExecStart=$NODE_EXEC_PATH $APP_FILE
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=$SERVICE_NAME
[Install]
WantedBy=multi-user.target
EOF
  echo "   - Service file created."
}

##
# Step 7: Finalize setup and display banner
##
finalize_setup() {
  echo "➡️ Step 7: Enabling services and preparing final instructions..."
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME".service
  systemctl enable --now nginx.service
  
  echo ""
  echo "========================================================================"
  echo "✅                    INSTALLATION COMPLETE                           ✅"
  echo "========================================================================"
  echo ""
  echo "The application and Nginx services are now running."
  echo "Your final step is to generate and save the authentication token."
  echo ""
  echo "--- FOLLOW THESE STEPS ---"
  echo ""
  echo "1. GENERATE THE TOKEN:"
  echo "   Run the following command. When prompted, press the action button"
  echo "   on the bottom of your Dirigera hub."
  echo ""
  echo "   sudo su -s /bin/bash -c \"source ~/.nvm/nvm.sh && npx dirigera authenticate\" \"$APP_USER\""
  echo ""
  echo "2. SAVE THE TOKEN:"
  echo "   The command above will print a long token. Copy it, then paste it"
  echo "   into this command (replacing the placeholder text):"
  echo ""
  echo "   echo \"PASTE_YOUR_TOKEN_HERE\" | sudo tee $APP_DIR/token.txt"
  echo ""
  echo "3. RESTART THE APPLICATION SERVICE:"
  echo "   For the new token to be loaded, you must restart the app service:"
  echo ""
  echo "   sudo systemctl restart $SERVICE_NAME"
  echo ""
  echo "--- USEFUL COMMANDS ---"
  echo ""
  echo "To check your app's status:  sudo systemctl status $SERVICE_NAME"
  echo "To view your app's live logs: sudo journalctl -u $SERVICE_NAME -f"
  echo "To manage Nginx:             sudo systemctl status/restart/stop nginx"
  echo ""
  echo "========================================================================"
}

# --- Run main function ---
main