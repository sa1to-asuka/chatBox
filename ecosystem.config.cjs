module.exports = {
  apps: [
    {
      name: 'chatbox',
      cwd: __dirname,
      script: 'build/server/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '350M',
      time: true,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3006',
        DATA_DIR: './data',
        STATIC_DIR: './dist',
        COOKIE_SECURE: 'true',
        TRUST_PROXY: 'true',
      },
    },
  ],
}
