import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),javaHome=fs.existsSync(path.join(root,'.runtime/jdk17/bin/java'))?path.join(root,'.runtime/jdk17'):process.env.JAVA_HOME||path.join(root,'.runtime/jdk17'),java=path.join(javaHome,'bin/java');
if(!fs.existsSync(java))throw Error('Build the Java backend first: npm run build:java');
const child=spawn(java,['-Xms64m','-Xmx192m','-XX:MaxMetaspaceSize=128m','-XX:ReservedCodeCacheSize=64m','-Xss512k','-XX:+UseSerialGC','-jar',path.join(root,'backend/target/induport-backend-2.0.0.jar')],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'production',JAVA_HOME:javaHome}});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));
