import {openDatabase} from '../server/storage.js';
import {ensureAdmin} from '../server/auth.js';
if(!process.env.ADMIN_USERNAME||!process.env.ADMIN_PASSWORD)throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in your private environment first');
const store=await openDatabase();try{await ensureAdmin(store);console.log('Administrator account is ready. No password is printed.')}finally{await store.close()}
