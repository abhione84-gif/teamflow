import writeExcelFile from 'write-excel-file/universal';
import { formatDeadline } from './deadlines.js';

const header=values=>values.map(value=>({value,type:String,fontWeight:'bold',backgroundColor:'#7350A0',textColor:'#FFFFFF',wrap:true}));
const text=value=>({value:String(value??''),type:String,wrap:true,verticalAlign:'top'});
export function reportSheets(report,{workspace,scope,nameFor,projectFor}) {
  const basis={due:'Due in month',created:'Created in month',completed:'Completed in month'}[report.basis];
  const summary=[header(['Teamflow monthly report','Value']),...[
    ['Workspace',workspace],['Month',report.month],['Date basis',basis],['Report time zone',report.zone],['Access scope',scope],['Generated at (UTC)',report.generatedAt],['Tasks',report.total],['Completed',report.completed],['Open',report.open],['Overdue now',report.overdue],['Completion rate',report.completionRate+'%'],['Completed on time',report.onTime+' of '+report.timedCompleted],['Counting','Shared tasks are counted once. By owner uses the primary owner.'],['Status','Current task status; this is not a historical month-end snapshot.']
  ].map(([label,value])=>[text(label),typeof value==='number'?{value,type:Number}:text(value)])];
  const tasks=[header(['Task ID','Task','Project','Primary owner','Owner email','Collaborators','Status','Priority','Due date/time','Due time zone','Due instant (UTC)','Created (UTC)','Completed (UTC)','Follow-up date','Notes']),...report.tasks.map(task=>[
    task.id,task.title,projectFor(task.project),nameFor(task.owner),task.owner,(task.collaborators||[]).map(email=>nameFor(email)+' <'+email+'>').join('; '),task.status,task.priority,formatDeadline(task),task.dueTimezone,task.dueAt,task.createdAt,task.completedAt,task.followup,task.notes
  ].map(text))];
  const owners=[header(['Primary owner','Email','Tasks','Completed','Open','Overdue now']),...report.owners.map(row=>[text(nameFor(row.owner)),text(row.owner),{value:row.total,type:Number},{value:row.completed,type:Number},{value:row.total-row.completed,type:Number},{value:row.overdue,type:Number}])];
  return [{sheet:'Summary',data:summary,columns:[{width:27},{width:90}]},{sheet:'Tasks',data:tasks,columns:[36,35,22,23,30,50,18,12,30,25,28,28,28,18,55].map(width=>({width})),stickyRowsCount:1},{sheet:'By owner',data:owners,columns:[26,32,12,12,12,15].map(width=>({width})),stickyRowsCount:1}];
}
export async function reportWorkbook(report,labels) { return writeExcelFile(reportSheets(report,labels)).toBlob(); }
