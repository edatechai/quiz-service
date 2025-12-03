module.exports = {
    apps: [{
      name: 'quiz-service',
      script: 'src/server.js',
      node_args: '--experimental-json-modules',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5001,
        CLOUDINARY_CLOUD_NAME:'dipkn1zwr',
        CLOUDINARY_API_KEY: '856983818922689',
        CLOUDINARY_API_SECRET: 'fGtd5Ar9EIdSxkT3dCdmkQ2L8Nk',
        MONGO_URL :'mongodb+srv://edat:Mayorgnn%40088@edat.jotcbls.mongodb.net/production?retryWrites=true&w=majority&appName=Edat',
       
  
  EMAIL_USER :'edatech@edatech.io',
  EMAIL_PASS :'hmfmxfpvvgnudseg',
  EMAIL_HOST :'mail.edatech.ai',
  EDATECH_EMAIL_PASSWORD :'1echedP1atform*',
  PASSWORD_RESET_EMAIL : 'passwordreset@edatech.ai',
  WELCOME_EMAIL :'welcome@edatech.ai',
  EDATECH_SUPPORT_EMAIL :'support@edatech.ai'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    }]
  };