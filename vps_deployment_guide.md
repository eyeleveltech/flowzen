# VPS Deployment & CI/CD Guide

This guide covers how to set up your VPS to host your Turborepo application (Next.js Frontend + Express Backend) and configure a GitHub Actions CI/CD pipeline for automated deployments and database migrations.

> [!NOTE]
> This guide assumes your VPS is running a Linux distribution like Ubuntu 20.04/22.04 and that you already have PostgreSQL installed and running.

---

## 1. Database Setup

Since you already have PostgreSQL installed, you just need to create a dedicated database and user for this project.

1. SSH into your VPS and log into the Postgres prompt:
   ```bash
   sudo -u postgres psql
   ```
2. Create the database and user (replace `your_password` with a strong password):
   ```sql
   CREATE DATABASE saas_production;
   CREATE USER saas_admin WITH ENCRYPTED PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE saas_production TO saas_admin;
   \c saas_production;
   GRANT ALL ON SCHEMA public TO saas_admin;
   \q
   ```
3. Your database connection string will look like this:
   `postgresql://saas_admin:your_password@localhost:5432/saas_production?schema=public`

---

## 2. Initial VPS Environment Setup

You need Node.js, PM2 (to keep your apps running forever), and Nginx (for routing traffic).

### Install Node.js & Dependencies
```bash
# Install Node.js (v20 recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 and Yarn/pnpm globally
sudo npm install -g pm2 yarn pnpm
```

### Setup Project Directory
```bash
sudo mkdir -p /var/www/saas
sudo chown -R $USER:$USER /var/www/saas
```

---

## 3. CI/CD Setup: GitHub Actions

We will use GitHub Actions to automatically SSH into your VPS, pull the latest code, install dependencies, run Prisma migrations, build the apps, and restart PM2.

### Step A: Configure GitHub Secrets
Go to your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**. Add the following repository secrets:
- `HOST`: Your VPS IP address
- `USERNAME`: Your VPS SSH username (e.g., `root` or `ubuntu`)
- `SSH_KEY`: The private SSH key (`~/.ssh/id_rsa`) from your local machine that has access to the VPS. *(Ensure the public key is in the VPS's `~/.ssh/authorized_keys`)*.

### Step B: Create the GitHub Actions Workflow
In your codebase, create a file at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches:
      - main # Triggers on push to main branch

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /var/www/saas
            
            # 1. Pull latest changes
            git pull origin main
            
            # 2. Install dependencies
            npm install
            
            # 3. Run Prisma Migrations (updates the database schema)
            cd apps/api
            npx prisma migrate deploy
            npx prisma generate
            cd ../..
            
            # 4. Build the monorepo (Frontend & Backend)
            npm run build
            
            # 5. Restart PM2 processes
            pm2 restart all --update-env
            pm2 save
```

> [!WARNING]
> The very first time you deploy, you will need to manually clone the repository into `/var/www/saas` and create the `.env` files so the pipeline has a base directory to work with.

---

## 4. Manual First Deployment & PM2 Setup

Before the pipeline can work seamlessly, you must initialize the project on the VPS manually once.

1. **Clone the repository:**
   ```bash
   cd /var/www
   git clone https://github.com/your-username/your-repo.git saas
   cd saas
   ```

2. **Create Environment Variables:**
   You need two `.env` files. One for the API and one for the Web app.

   **`apps/api/.env`**
   ```env
   PORT=3001
   DATABASE_URL="postgresql://saas_admin:your_password@localhost:5432/saas_production?schema=public"
   JWT_SECRET="generate_a_very_long_random_string_here"
   JWT_EXPIRES_IN="7d"
   # SMTP Configs...
   ```

   **`apps/web/.env`** (or `.env.local`)
   ```env
   NEXT_PUBLIC_API_URL="https://api.yourdomain.com/api"
   NEXT_PUBLIC_SOCKET_URL="https://api.yourdomain.com"
   ```

3. **Install, Migrate, and Build:**
   ```bash
   npm install
   cd apps/api
   npx prisma migrate deploy
   npx prisma generate
   cd ../..
   npm run build
   ```

4. **Start the Apps with PM2:**
   We will start both the Express API and the Next.js frontend using PM2.
   ```bash
   # Start the Express API
   pm2 start apps/api/dist/index.js --name "saas-api"

   # Start the Next.js Frontend
   pm2 start "npm run start --workspace=apps/web" --name "saas-web"

   # Save PM2 configuration to restart automatically on server reboot
   pm2 save
   pm2 startup
   ```

---

## 5. Apache Reverse Proxy Setup

Apache will route incoming web traffic on port 80/443 to your local Next.js (port 3000) and Express (port 3001) instances.

1. **Enable Apache Proxy Modules:**
   ```bash
   sudo a2enmod proxy
   sudo a2enmod proxy_http
   sudo a2enmod proxy_wstunnel
   sudo a2enmod rewrite
   sudo systemctl restart apache2
   ```

2. **Create Apache Virtual Hosts Configuration:**
   Create a new file `/etc/apache2/sites-available/saas.conf`:
   ```bash
   sudo nano /etc/apache2/sites-available/saas.conf
   ```

3. **Add the Routing Rules:**
   Assuming you have a main domain for the frontend (`app.yourdomain.com`) and a subdomain for the API (`api.yourdomain.com`):

   ```apache
   # API Server Configuration
   <VirtualHost *:80>
       ServerName api.yourdomain.com
       
       # Proxy headers
       ProxyPreserveHost On
       
       # WebSocket Support (for Socket.io)
       RewriteEngine On
       RewriteCond %{HTTP:Upgrade} =websocket [NC]
       RewriteRule /(.*)           ws://localhost:3001/$1 [P,L]

       # HTTP traffic
       ProxyPass / http://localhost:3001/
       ProxyPassReverse / http://localhost:3001/
   </VirtualHost>

   # Frontend Configuration
   <VirtualHost *:80>
       ServerName app.yourdomain.com

       # Proxy headers
       ProxyPreserveHost On

       # WebSocket Support (for Next.js HMR)
       RewriteEngine On
       RewriteCond %{HTTP:Upgrade} =websocket [NC]
       RewriteRule /(.*)           ws://localhost:3000/$1 [P,L]

       # HTTP traffic
       ProxyPass / http://localhost:3000/
       ProxyPassReverse / http://localhost:3000/
   </VirtualHost>
   ```

4. **Enable the Configuration:**
   ```bash
   sudo a2ensite saas.conf
   sudo systemctl reload apache2
   ```

> [!TIP]
> **Securing with SSL (HTTPS)**
> Don't forget to run Certbot to automatically add SSL certificates to your domains!
> `sudo apt install python3-certbot-apache`
> `sudo certbot --apache -d app.yourdomain.com -d api.yourdomain.com`
