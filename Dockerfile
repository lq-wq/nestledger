# 栖间 · NestLedger —— 单容器、零 npm 依赖
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    TZ=Asia/Shanghai

WORKDIR /app

# 只复制运行必需的两个文件 + 一个网页
COPY server/package.json server/index.js ./server/
COPY web/index.html ./web/

RUN mkdir -p /data/backups

VOLUME ["/data"]
EXPOSE 8787

# 健康检查接口无需认证，只返回版本与是否有数据
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const h=require('http');h.get({host:'127.0.0.1',port:Number(process.env.PORT||8787),path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js"]
