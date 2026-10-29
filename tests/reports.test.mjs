import test from 'node:test';
import assert from 'node:assert/strict';
import readExcelFile from 'read-excel-file/node';
import {monthlyReport,reportMonth,reportScope} from '../src/report-data.js';
import {reportWorkbook} from '../src/report-excel.js';
const task={id:'1',title:'Shared task',owner:'alice@example.invalid',collaborators:['bob@example.invalid'],project:'p',status:'Done',priority:'High',dueAt:'2026-10-29T10:00:00Z',dueTimezone:'Asia/Bangkok',createdAt:'2026-09-20T10:00:00Z',completedAt:'2026-10-29T09:00:00Z'};
test('monthly totals count shared tasks once and filter using the selected date basis',()=>{
 const data={tasks:[task,task,{...task,id:'2',status:'To do',completedAt:null},{...task,id:'3',dueAt:null,due:'',completedAt:null,status:'To do'}]};
 const due=monthlyReport(data,{month:'2026-10',zone:'UTC',now:Date.parse('2026-10-30T00:00:00Z')});
 assert.equal(due.total,2);assert.equal(due.completed,1);assert.equal(due.overdue,1);assert.equal(due.onTime,1);assert.equal(due.owners[0].total,2);
 assert.equal(monthlyReport(data,{month:'2026-09',basis:'created',zone:'UTC'}).total,3);
 assert.equal(monthlyReport(data,{month:'2026-10',basis:'completed',zone:'UTC'}).total,1);
});
test('report month boundaries follow the displayed report time zone',()=>{
 assert.equal(reportMonth('2026-10-31T23:00:00Z','Asia/Bangkok'),'2026-11');
 assert.equal(reportMonth('2026-10-31T23:00:00Z','America/New_York'),'2026-10');
 assert.throws(()=>monthlyReport({tasks:[]},{month:'2026-13'}),/valid report month/);
 assert.match(reportScope('Supervisor'),/assigned team/);
});
test('Excel downloads contain three readable worksheets and keep formula-looking task text literal',async()=>{
 const report=monthlyReport({tasks:[{...task,title:'=HYPERLINK("https://example.invalid","click")',notes:'<script>literal</script>'}]},{month:'2026-10',zone:'UTC'});
 const blob=await reportWorkbook(report,{workspace:"Abhi's workspace",scope:reportScope('Member'),nameFor:email=>email,projectFor:()=> 'General'});
 assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const sheets=await readExcelFile(Buffer.from(await blob.arrayBuffer()));
 assert.deepEqual(sheets.map(sheet=>sheet.sheet),['Summary','Tasks','By owner']);
 const tasks=sheets[1].data;
 assert.equal(tasks.length,2);assert.equal(tasks[1][1],'=HYPERLINK("https://example.invalid","click")');
 assert.match(tasks[1][5],/bob@example.invalid/);assert.equal(sheets[2].data[1][2],1);
});
test('empty reports remain downloadable and preserve zero totals',async()=>{
 const report=monthlyReport({tasks:[]},{month:'2026-02',zone:'UTC'});
 const blob=await reportWorkbook(report,{workspace:'QA',scope:'Own tasks',nameFor:e=>e,projectFor:()=>''});
 const sheets=await readExcelFile(Buffer.from(await blob.arrayBuffer()));
 assert.equal(sheets[1].data.length,1);assert.equal(sheets[0].data.find(row=>row[0]==='Tasks')[1],0);assert.equal(report.completionRate,0);
});
test('Excel keeps Unicode, markup, quotes, and line breaks as literal values',async()=>{
 const title='日本語 – अभि 🙂 & < > " quoted';const notes='First line\nSecond line & <literal>';
 const report=monthlyReport({tasks:[{...task,title,notes}]},{month:'2026-10',zone:'UTC'});
 const blob=await reportWorkbook(report,{workspace:'QA',scope:'Own tasks',nameFor:e=>e,projectFor:()=>''});
 const sheets=await readExcelFile(Buffer.from(await blob.arrayBuffer()));assert.equal(sheets[1].data[1][1],title);assert.equal(sheets[1].data[1][14],notes);
});
