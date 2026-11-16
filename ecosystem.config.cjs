module.exports = {
  apps: [
    {
      name: 'chatbox',
      cwd: __dirname,
      script: 'build/server/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3006',
        DATA_DIR: './data',
        STATIC_DIR: './dist',
        COOKIE_SECURE: 'true',
        TRUST_PROXY: 'true',
        // 可选：PPT Master 原生渲染（不设置时自动回退到 PptxGenJS）
        // PPTMASTER_PYTHON: '/path/to/ppt-master/.venv/bin/python',
        // PPTMASTER_HOME: '/path/to/ppt-master/skills/ppt-master',
      },
    },
  ],
}
