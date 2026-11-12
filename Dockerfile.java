# syntax=docker/dockerfile:1
FROM node:24-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then export JAVA_EXTRA_CA_CERT=/run/secrets/proxy_ca; fi; \
    npm run build && node scripts/java-tools.mjs -B -DskipTests package
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/backend/target/induport-backend-2.0.0.jar app.jar
COPY --from=build /app/dist dist
ENV PORT=8080
EXPOSE 8080
USER 10001
ENTRYPOINT ["java","-Xms64m","-Xmx192m","-XX:MaxMetaspaceSize=128m","-XX:ReservedCodeCacheSize=64m","-Xss512k","-XX:+UseSerialGC","-jar","app.jar"]
