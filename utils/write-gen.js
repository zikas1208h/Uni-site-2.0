// helper: writes the real scheduleGenerator.js
const fs = require('fs');
const path = require('path');

const code = `'use strict';
var toMin=function(t){var p=t.split(':').map(Number);return p[0]*60+p[1];};
var toTime=function(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
var SLOT_DUR=120,DAY_START=480,DAY_END=1080;
var WORKING_DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Saturday'];
var NUM_GROUPS=6,NUM_SECTIONS=2;
var TIME_SLOTS=[];
for(var _s=DAY_START;_s+SLOT_DUR<=DAY_END;_s+=SLOT_DUR)TIME_SLOTS.push({start:_s,end:_s+SLOT_DUR});
var shuffle=function(arr){var a=arr.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp=a[i];a[i]=a[j];a[j]=tmp;}return a;};
function Registry(){this.used={};}
Registry.prototype.vKey=function(v,d,s){return 'V|'+v+'|'+d+'|'+s;};
Registry.prototype.sKey=function(id,d,s){return 'S|'+id+'|'+d+'|'+s;};
Registry.prototype.gKey=function(g,sec,d,s){return 'G|'+g+'|'+sec+'|'+d+'|'+s;};
Registry.prototype.has=function(k){return !!this.used[k];};
Registry.prototype.add=function(k){this.used[k]=1;};
Registry.prototype.canPlace=function(venue,staffId,group,section,day,start,isLecture){
  if(this.has(this.vKey(venue,day,start)))return false;
  if(this.has(this.sKey(staffId,day,start)))return false;
  if(isLecture){
    if(this.has(this.gKey(group,0,day,start)))return false;
    for(var s=1;s<=NUM_SECTIONS;s++)if(this.has(this.gKey(group,s,day,start)))return false;
  }else{
    if(this.has(this.gKey(group,section,day,start)))return false;
    if(this.has(this.gKey(group,0,day,start)))return false;
  }
  return true;
};
Registry.prototype.place=function(venue,staffId,group,section,day,start,isLecture){
  this.add(this.vKey(venue,day,start));
  this.add(this.sKey(staffId,day,start));
  if(isLecture){
    this.add(this.gKey(group,0,day,start));
    for(var s=1;s<=NUM_SECTIONS;s++)this.add(this.gKey(group,s,day,start));
  }else{
    this.add(this.gKey(group,section,day,start));
  }
};
function StaffTracker(){this.days={};this.slots={};}
StaffTracker.prototype.init=function(id){if(!this.days[id])this.days[id]=[];};
StaffTracker.prototype.slotsOnDay=function(id,day){return this.slots[id+'|'+day]||0;};
StaffTracker.prototype.canUse=function(id,day,maxDays,maxPerDay){
  this.init(id);
  var inDay=this.days[id].indexOf(day)!==-1;
  if(!inDay&&this.days[id].length>=maxDays)return false;
  if(this.slotsOnDay(id,day)>=maxPerDay)return false;
  return true;
};
StaffTracker.prototype.record=function(id,day){
  this.init(id);
  if(this.days[id].indexOf(day)===-1)this.days[id].push(day);
  var k=id+'|'+day;this.slots[k]=(this.slots[k]||0)+1;
};
var buildPools=function(rooms){
  if(!rooms||!rooms.length)return{
    amphitheatre:['Amphitheatre 1','Amphitheatre 2','Amphitheatre 3','Amphitheatre 4'],
    lab:['Lab 1','Lab 2','Lab 3','Lab 4','Lab 5','Lab 6','Lab 7','Lab 8'],
    room:['Room A5','Room A6']
  };
  var p={amphitheatre:[],lab:[],room:[]};
  for(var i=0;i<rooms.length;i++){var r=rooms[i];if(!p[r.type])p[r.type]=[];p[r.type].push(r.name);}
  return p;
};
var freePick=function(pool,reg,day,start){
  var sh=shuffle(pool);
  for(var i=0;i<sh.length;i++)if(!reg.has(reg.vKey(sh[i],day,start)))return sh[i];
  return null;
};
var generateMasterSchedule=function(courses,config){
  config=config||{};
  var slots=[],warnings=[],reg=new Registry(),tracker=new StaffTracker(),venues=buildPools(config.rooms);
  var DOC_MAX_DAYS=2,AST_MAX_DAYS=3,AST_MAX_SLOT=5;
  for(var ci=0;ci<courses.length;ci++){
    var course=courses[ci],docs=course.doctors||[];
    if(!docs.length){warnings.push(course.courseCode+': no doctor');continue;}
    for(var group=1;group<=NUM_GROUPS;group++){
      var doc=docs.length>=2?(group<=3?docs[0]:docs[1]):docs[0];
      var docId=String(doc._id||doc),placed=false;
      var days=shuffle(WORKING_DAYS),tss=shuffle(TIME_SLOTS);
      outer1:for(var di=0;di<days.length;di++){
        var day=days[di];
        if(!tracker.canUse(docId,day,DOC_MAX_DAYS,999))continue;
        for(var ti=0;ti<tss.length;ti++){
          var ts=tss[ti];
          var venue=freePick(venues.amphitheatre,reg,day,ts.start);
          if(!venue)continue;
          if(!reg.canPlace(venue,docId,group,0,day,ts.start,true))continue;
          reg.place(venue,docId,group,0,day,ts.start,true);
          tracker.record(docId,day);
          slots.push({day:day,startTime:toTime(ts.start),endTime:toTime(ts.end),type:'lecture',venue:venue,venueType:'amphitheatre',courseId:course._id,courseCode:course.courseCode,courseName:course.courseName,staffId:docId,staffName:doc.firstName?'Dr. '+doc.firstName+' '+doc.lastName:docId,staffRole:'doctor',group:group,section:null});
          placed=true;break outer1;
        }
      }
      if(!placed)warnings.push(course.courseCode+' Group '+group+': lecture unscheduled');
    }
  }
  for(var ci2=0;ci2<courses.length;ci2++){
    var course2=courses[ci2],asstList=course2.assistants||[];
    if(!asstList.length){warnings.push(course2.courseCode+': no assistant');continue;}
    var allJobs=[];
    for(var g=1;g<=NUM_GROUPS;g++)for(var sc=1;sc<=NUM_SECTIONS;sc++)allJobs.push({group:g,section:sc});
    var jobs=shuffle(allJobs),aIdx=0;
    for(var ji=0;ji<jobs.length;ji++){
      var job=jobs[ji],placed2=false;
      for(var att=0;att<asstList.length;att++){
        var asst=asstList[(aIdx+att)%asstList.length],aId=String(asst._id||asst);
        var days2=shuffle(WORKING_DAYS),tss2=shuffle(TIME_SLOTS);
        outer2:for(var di2=0;di2<days2.length;di2++){
          var day2=days2[di2];
          if(!tracker.canUse(aId,day2,AST_MAX_DAYS,AST_MAX_SLOT))continue;
          for(var ti2=0;ti2<tss2.length;ti2++){
            var ts2=tss2[ti2];
            var vPool=venues.lab.concat(venues.room);
            var venue2=freePick(vPool,reg,day2,ts2.start);
            if(!venue2)continue;
            if(!reg.canPlace(venue2,aId,job.group,job.section,day2,ts2.start,false))continue;
            reg.place(venue2,aId,job.group,job.section,day2,ts2.start,false);
            tracker.record(aId,day2);
            slots.push({day:day2,startTime:toTime(ts2.start),endTime:toTime(ts2.end),type:'section',venue:venue2,venueType:venues.lab.indexOf(venue2)!==-1?'lab':'room',courseId:course2._id,courseCode:course2.courseCode,courseName:course2.courseName,staffId:aId,staffName:asst.firstName?asst.firstName+' '+asst.lastName:aId,staffRole:'assistant',group:job.group,section:job.section});
            placed2=true;aIdx++;break outer2;
          }
        }
        if(placed2)break;
      }
      if(!placed2)warnings.push(course2.courseCode+' G'+job.group+'S'+job.section+': section unscheduled');
    }
  }
  var dayIdx={Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Saturday:5};
  slots.sort(function(a,b){var dd=(dayIdx[a.day]!=null?dayIdx[a.day]:9)-(dayIdx[b.day]!=null?dayIdx[b.day]:9);return dd!==0?dd:toMin(a.startTime)-toMin(b.startTime);});
  return{slots:slots,warnings:warnings};
};
var generateSchedule=function(student,enrolledCourses,config){
  var master=config&&config._masterSlots?config._masterSlots:[];
  var g=student.lectureGroup,s=student.section;
  if(!g||!s)return[];
  var enrolled={};(enrolledCourses||[]).forEach(function(c){enrolled[String(c._id||c)]=true;});
  return master.filter(function(slot){return enrolled[String(slot.courseId)]&&((slot.type==='lecture'&&slot.group===g)||(slot.type==='section'&&slot.group===g&&slot.section===s));});
};
module.exports={generateMasterSchedule:generateMasterSchedule,generateSchedule:generateSchedule,toMin:toMin,toTime:toTime};
`;

fs.writeFileSync(path.join(__dirname, 'scheduleGenerator.js'), code, 'utf8');
console.log('Written OK, size:', fs.statSync(path.join(__dirname, 'scheduleGenerator.js')).size);



