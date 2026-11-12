// Starts Java against a fresh, isolated localhost MySQL database. Never accepts a cloud database.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import mysql from 'mysql2/promise';
const configPath=process.env.JAVA_TEST_DB_CONFIG;
if(!configPath)throw Error('Set JAVA_TEST_DB_CONFIG to a private localhost MySQL test configuration');
const c=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(c.host!=='127.0.0.1'||!c.database.endsWith('_test'))throw Error('Only an isolated localhost _test database is allowed');
const database='induport_java_'+Date.now()+'_'+Math.random().toString(16).slice(2,8)+'_test';
const connection=await mysql.createConnection({...c,database:undefined});await connection.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');await connection.end();
if(process.env.JAVA_TEST_LEGACY_FIXTURE==='true'){const {seedJavaCompatibility}=await import('./seed-java-compat-fixture.mjs');await seedJavaCompatibility({...c,database});}
if((process.env.SPRING_PROFILES_ACTIVE||'').split(',').includes('infra')){const q=await mysql.createConnection({...c,database,multipleStatements:true});await q.query(fs.readFileSync('backend/src/main/resources/db/quartz.sql','utf8'));await q.end();}
const infra=process.env.JAVA_TEST_INFRA_CONFIG?JSON.parse(fs.readFileSync(process.env.JAVA_TEST_INFRA_CONFIG,'utf8')):{};
const executable=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin/java'):path.resolve('.tools/jdk17/bin/java');
const child=spawn(executable,['-Xms64m','-Xmx192m','-XX:MaxMetaspaceSize=128m','-XX:ReservedCodeCacheSize=64m','-Xss512k','-XX:+UseSerialGC','-jar','backend/target/induport-backend-2.0.0.jar'],{stdio:'inherit',env:{...process.env,PORT:process.env.PORT||'3001',INDUPORT_JDBC_URL:`jdbc:mysql://127.0.0.1:${c.port}/${database}?sslMode=DISABLED&serverTimezone=UTC&characterEncoding=UTF-8`,MYSQL_USER:c.user,MYSQL_PASSWORD:c.password,MYSQL_SSL:'false',COOKIE_SECURE:'false',INDUPORT_JOBS_ENABLED:process.env.INDUPORT_TEST_JOBS||'false',INDUPORT_MQ_ENABLED:process.env.INDUPORT_TEST_MQ||'false',INDUPORT_REDIS_ENABLED:process.env.INDUPORT_TEST_REDIS||'false',REDIS_HOST:infra.redisHost||'127.0.0.1',RABBITMQ_HOST:infra.rabbitHost||'127.0.0.1',RABBITMQ_USER:infra.rabbitUser||'guest',RABBITMQ_PASSWORD:infra.rabbitPassword||'guest',ADMIN_USERNAME:'e2e_admin',ADMIN_PASSWORD:'E2E-local-only-Password9!',NODE_ENV:'test'}});
fs.writeFileSync('/tmp/induport-java-test-'+(process.env.PORT||'3001')+'.json',JSON.stringify({...c,database}),{mode:0o600});
let stopping=false;const stop=()=>{if(!stopping){stopping=true;child.kill('SIGTERM')}};process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',async code=>{try{const x=await mysql.createConnection({...c,database:undefined});await x.query('DROP DATABASE `'+database+'`');await x.end()}finally{process.exit(code||0)}});
