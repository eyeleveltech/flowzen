# Flowzen VPS Deployment Guide (Dockerized)

This guide covers how to deploy the fully containerized Flowzen application (Next.js Frontend + Express Backend + PostgreSQL + Redis + Automated Backups) to a VPS using Docker.

> [!NOTE]
> This guide assumes your VPS is running a Linux distribution like Ubuntu 20.04/22.04. Because the entire stack is Dockerized, you **do not** need to install Node.js, PostgreSQL, or Redis manually on the host machine!

---

## 1. Initial VPS Setup (Install Docker)

SSH into your VPS and install Docker and Git.

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Git
sudo apt install git -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose plugin
sudo apt-get install docker-compose-plugin -y

# (Optional) Add your user to the docker group so you don't need 'sudo'
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Clone the Repository

Create a directory for your application and clone the code.

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/your-username/flowzen.git saas
cd saas
```

---

## 3. Environment Variables

You need to set up the global `.env` file in the root of the project. This single file will power all the Docker containers.

```bash
cp .env.example .env
nano .env
```

Ensure your `.env` contains the following critical variables for production:

```env
# General
NODE_ENV="production"
PORT=4000
NEXT_PUBLIC_APP_URL="https://app.yourdomain.com"
NEXT_PUBLIC_API_URL="https://api.yourdomain.com/api"

# Database
POSTGRES_USER="flowzen_user"
POSTGRES_PASSWORD="your_strong_db_password"
POSTGRES_DB="flowzen_prod"
DATABASE_URL="postgresql://flowzen_user:your_strong_db_password@postgres:5432/flowzen_prod?schema=public"

# Redis Caching
REDIS_URL="redis://redis:6379"

# Security
JWT_SECRET="generate_a_very_long_secure_random_string"
JWT_EXPIRES_IN="7d"

# Email Verification (Leave empty to use temporary Ethereal mock emails, or add your Google App Password)
EMAIL_USER="your-email@gmail.com"
EMAIL_PASS="your_16_char_google_app_password"
```

---

## 4. Deploy with Docker Compose

Because the application is fully Dockerized, deployment is now a single command. Docker will automatically build the images, spin up the database, start Redis, run Prisma migrations, and start the frontend/backend servers.

```bash
docker compose up -d --build
```

To view the logs and ensure everything started correctly:
```bash
docker compose logs -f
```

### What Docker spins up:
- **`postgres`**: The database running on internal port 5432.
- **`redis`**: The caching layer running on internal port 6379.
- **`api`**: The Express backend running on host port `4000`.
- **`web`**: The Next.js frontend running on host port `3000`.
- **`db-backup`**: An automated sidecar container that backs up your database daily and keeps a 7-day rolling history.

---

## 5. Apache Reverse Proxy Setup (Optional but Recommended)

While your apps are running on ports 3000 and 4000, you likely want them accessible via standard HTTP/HTTPS (port 80/443). Apache will route incoming web traffic to your Docker containers.

1. **Enable Apache Proxy Modules:**
   ```bash
   sudo apt install apache2 -y
   sudo a2enmod proxy proxy_http rewrite headers
   sudo systemctl restart apache2
   ```

2. **Create Apache Virtual Hosts Configuration:**
   ```bash
   sudo nano /etc/apache2/sites-available/flowzen.conf
   ```

3. **Add the Routing Rules:**
   Assuming `app.yourdomain.com` is the frontend and `api.yourdomain.com` is the backend:

   ```apache
   # API Server Configuration
   <VirtualHost *:80>
       ServerName api.yourdomain.com
       
       ProxyPreserveHost On
       
       # HTTP traffic -> Route to Docker API container
       ProxyPass / http://localhost:4000/
       ProxyPassReverse / http://localhost:4000/
   </VirtualHost>

   # Frontend Configuration
   <VirtualHost *:80>
       ServerName app.yourdomain.com

       ProxyPreserveHost On

       # HTTP traffic -> Route to Docker Web container
       ProxyPass / http://localhost:3000/
       ProxyPassReverse / http://localhost:3000/
   </VirtualHost>
   ```

4. **Enable the Configuration:**
   ```bash
   sudo a2ensite flowzen.conf
   sudo systemctl reload apache2
   ```

> [!TIP]
> **Securing with SSL (HTTPS)**
> Run Certbot to automatically add SSL certificates to your domains!
> `sudo apt install python3-certbot-apache`
> `sudo certbot --apache -d app.yourdomain.com -d api.yourdomain.com`

---

## 6. Updating the App

When you push new code to your repository, updating the VPS is incredibly simple:

```bash
cd /var/www/saas
git pull origin main
docker compose up -d --build
```

*(Note: We also have a GitHub Actions file `.github/workflows/deploy.yml` which automates this exact process whenever you push to `main`!)*
