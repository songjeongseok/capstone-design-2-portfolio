// Public demonstration uses synthetic records and in-memory storage only.
// It never reads or writes the browser's real account or submission storage.
import {LocalStore,STORE_KEY,SESSION_KEY} from './local-store.mjs';
import {sampleUploads} from './examples.mjs';
export function createDemoStore(){
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const member={id:'demo-student',studentId:'demo-archive',name:'체험 학생',email:'demo@example.invalid',role:'student',status:'active'};
 storage.setItem(STORE_KEY,JSON.stringify({schemaVersion:2,revision:0,members:[member],imports:[],records:sampleUploads.s1.slice(0,2).map((r,i)=>({...r,id:'demo-'+(i+1),studentId:member.studentId,version:1,history:[],createdAt:Date.now(),updatedAt:Date.now(),deletedAt:null,reviewStatus:'legacy-unverified'}))}));
 storage.setItem(SESSION_KEY,member.id);const store=new LocalStore(storage,storage);store.isDemo=true;return store;
}
