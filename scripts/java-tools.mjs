import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=path.join(root,'.runtime');fs.mkdirSync(runtime,{recursive:true});
const run=(cmd,args,opts={})=>{const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,...opts});if(r.status!==0)throw Error('Tool failed: '+path.basename(cmd));return r.stdout;};
async function download(url,target,algorithm,expected){run('curl',['--fail','--location','--silent','--show-error','--retry','2','--connect-timeout','20','--output',target,url]);if(expected){const sum=createHash(algorithm).update(fs.readFileSync(target)).digest('hex');if(sum!==expected.trim().split(/\s/)[0])throw Error('Toolchain checksum mismatch');}}
function text(url){return run('curl',['--fail','--location','--silent','--show-error','--connect-timeout','20',url]).trim();}
export async function tools(){
 let javaHome=process.env.JAVA_HOME;
 if(!javaHome||!fs.existsSync(path.join(javaHome,'bin','javac'))||!fs.existsSync(path.join(javaHome,'release'))||!/^JAVA_VERSION="17[."]/m.test(fs.readFileSync(path.join(javaHome,'release'),'utf8'))){
  javaHome=path.join(runtime,'jdk17');
  if(!fs.existsSync(path.join(javaHome,'bin','javac'))){
   if(process.platform!=='linux'||process.arch!=='x64')throw Error('Install JDK 17 and set JAVA_HOME on this platform');
   const name='OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz',url='https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/'+name,file=path.join(runtime,name);
   await download(url,file,'sha256',text(url+'.sha256.txt'));const folder=run('tar',['-tzf',file]).split('\n')[0].split('/')[0];run('tar',['-xzf',file,'-C',runtime]);fs.symlinkSync(folder,javaHome,'dir');fs.unlinkSync(file);
  }
 }
 let maven=path.join(runtime,'apache-maven-3.9.16','bin','mvn');
 if(!fs.existsSync(maven)){
  if(process.platform!=='linux')throw Error('Use installed Maven 3.9: mvn -f backend/pom.xml package');
  const name='apache-maven-3.9.16-bin.tar.gz',url='https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.16/'+name,file=path.join(runtime,name);await download(url,file,'sha512',text(url+'.sha512'));run('tar',['-xzf',file,'-C',runtime]);fs.unlinkSync(file);
 }
 const args=[],xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy;
 let settingsXml='<settings><localRepository>'+xml(path.join(runtime,'m2/repository'))+'</localRepository>';
 if(proxy){const u=new URL(proxy);settingsXml+='<proxies><proxy><id>environment</id><active>true</active><protocol>http</protocol><host>'+xml(u.hostname)+'</host><port>'+xml(u.port||80)+'</port>'+(u.username?'<username>'+xml(decodeURIComponent(u.username))+'</username><password>'+xml(decodeURIComponent(u.password))+'</password>':'')+'<nonProxyHosts>localhost|127.0.0.1</nonProxyHosts></proxy></proxies>';}
 const settings=path.join(runtime,'maven-settings.xml');fs.writeFileSync(settings,settingsXml+'</settings>',{mode:0o600});args.push('-s',settings);
 let trust=process.env.JAVA_TRUSTSTORE;if(!trust&&fs.existsSync('/etc/ssl/certs/java/cacerts'))trust='/etc/ssl/certs/java/cacerts';
 const ca=process.env.JAVA_EXTRA_CA_CERT||process.env.CODEX_PROXY_CERT;if(ca&&fs.existsSync(ca)){trust=path.join(runtime,'maven-cacerts');fs.copyFileSync(path.join(javaHome,'lib/security/cacerts'),trust);run(path.join(javaHome,'bin/keytool'),['-importcert','-noprompt','-trustcacerts','-alias','environment-ca','-file',ca,'-keystore',trust,'-storepass','changeit']);}
 const env={...process.env,JAVA_HOME:javaHome,...(trust?{MAVEN_OPTS:(process.env.MAVEN_OPTS||'')+' -Djavax.net.ssl.trustStore='+trust}:{})};
 return {root,javaHome,maven,args,env};
}
export async function maven(args){const t=await tools();const child=spawn(t.maven,[...t.args,'-f','backend/pom.xml',...args],{cwd:root,env:t.env,stdio:'inherit'});for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await maven(process.argv.slice(2));
