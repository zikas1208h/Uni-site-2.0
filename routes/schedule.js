const express = require('express');
const router  = express.Router();
const { Schedule, MasterSchedule } = require('../models/Schedule');
const ScheduleConfig = require('../models/ScheduleConfig');
const Course         = require('../models/Course');
const User           = require('../models/User');
const { auth, isAdmin, requireSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const { generateMasterSchedule, generateSchedule } = require('../utils/scheduleGenerator');
const sc = require('../utils/serverCache');

// Cache key helpers
const SCHED_MASTER_KEY  = 'schedule:master';
const SCHED_VENUES_KEY  = 'schedule:venues';
const schedStaffKey = (id) => `schedule:staff:${id}`;
const schedStudentKey = (id) => `schedule:student:${id}`;
const invalidateScheduleCache = () => {
  sc.del(SCHED_MASTER_KEY);
  sc.del(SCHED_VENUES_KEY);
  sc.del('schedule:staff:');   // wipes all staff schedule keys (prefix)
  sc.del('schedule:student:'); // wipes all student schedule keys (prefix)
};

const getOrCreateConfig = async () => {
  let cfg = await ScheduleConfig.findOne();
  if (!cfg) cfg = await ScheduleConfig.create({});
  return cfg;
};

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// CONFIG
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
router.get('/config', auth, isAdmin, async (req, res) => {
  try { res.json(await getOrCreateConfig()); }
  catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

router.put('/config', auth, requireSuperAdmin, async (req, res) => {
  try {
    let cfg = await ScheduleConfig.findOne();
    const fields = ['workingDays','dayStartTime','dayEndTime','breakBetweenSlots',
      'lectureDuration','sectionDuration','labDuration','maxLecturesPerDay',
      'maxSectionsPerDay','maxSlotsPerStudentPerDay','rooms','semester','year'];
    if (!cfg) {
      cfg = new ScheduleConfig(req.body);
    } else {
      fields.forEach(f => { if (req.body[f] !== undefined) cfg[f] = req.body[f]; });
      cfg.version = (cfg.version || 1) + 1;
    }
    await cfg.save();
    res.json(cfg);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// COURSE STAFF ASSIGNMENT  (admin sets which doctors/assistants teach each course)
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

// GET /schedule/course-staff  â€” list all courses with their schedule staff
router.get('/course-staff', auth, isAdmin, async (req, res) => {
  try {
    const courses = await Course.find()
      .populate('scheduleDoctors',    'firstName lastName email role')
      .populate('scheduleAssistants', 'firstName lastName email role')
      .lean();
    res.json(courses);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// PUT /schedule/course-staff/:courseId  â€” set doctors & assistants for a course
router.put('/course-staff/:courseId', auth, requireSuperAdmin, async (req, res) => {
  try {
    const { doctors, assistants } = req.body;
    const update = {};
    if (doctors    !== undefined) update.scheduleDoctors    = doctors;
    if (assistants !== undefined) update.scheduleAssistants = assistants;
    const course = await Course.findByIdAndUpdate(req.params.courseId, update, { new: true })
      .populate('scheduleDoctors',    'firstName lastName email role')
      .populate('scheduleAssistants', 'firstName lastName email role');
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.json(course);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// MASTER SCHEDULE GENERATION  (superadmin)
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

// POST /schedule/generate-master
// Optional body params: { filterYear: 2, filterSemester: 'Spring' }
// When provided, only courses matching that year + semester with status:'active' are used.
// This is used to generate a schedule for e.g. "Year 2, Semester 4 (Spring) only".
router.post('/generate-master', auth, requireSuperAdmin, async (req, res) => {
  try {
    const cfg = await getOrCreateConfig();

    // â”€â”€ Build DB query â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { filterYear, filterSemester } = req.body || {};
    const courseQuery = { status: 'active' };
    if (filterYear      !== undefined && filterYear      !== null && filterYear      !== '')
      courseQuery.year     = Number(filterYear);
    if (filterSemester  !== undefined && filterSemester  !== null && filterSemester  !== '')
      courseQuery.semester = filterSemester;

    // Load courses matching the filter that have at least one doctor OR one assistant
    const allCourses = await Course.find(courseQuery)
      .populate('scheduleDoctors',    '_id firstName lastName')
      .populate('scheduleAssistants', '_id firstName lastName')
      .lean();

    // Only include courses that have staff assigned
    const courses = allCourses
      .filter(c => (c.scheduleDoctors?.length > 0) || (c.scheduleAssistants?.length > 0))
      .map(c => ({
        _id:        c._id,
        courseCode: c.courseCode,
        courseName: c.courseName,
        doctors:    c.scheduleDoctors    || [],
        assistants: c.scheduleAssistants || [],
      }));

    if (!courses.length) {
      const scope = filterYear ? ` for Year ${filterYear}${filterSemester ? ` / ${filterSemester}` : ''}` : '';
      return res.status(400).json({
        message: `No active courses with staff assigned found${scope}. Please assign staff to courses first.`
      });
    }

    const { slots, warnings } = generateMasterSchedule(courses, cfg);

    // Use the config semester/year for storage key (or the filter values if provided)
    const storedSemester = filterSemester || cfg.semester;
    const storedYear     = filterYear     ? Number(filterYear) : cfg.year;

    // Upsert master schedule
    const master = await MasterSchedule.findOneAndUpdate(
      { semester: storedSemester, year: storedYear },
      { semester: storedSemester, year: storedYear, slots, warnings, configVersion: cfg.version, generatedAt: new Date() },
      { upsert: true, new: true }
    );

    const scope = filterYear
      ? ` (Year ${filterYear}${filterSemester ? ` · ${filterSemester}` : ''} — ${courses.length} courses)`
      : ` (${courses.length} courses)`;

    // Invalidate schedule caches so next read reflects new data
    invalidateScheduleCache();

    res.json({
      message: `Master schedule generated${scope}: ${slots.length} slots, ${warnings.length} warnings.`,
      master,
      warnings,
      coursesIncluded: courses.length,
      filterApplied: { year: filterYear || null, semester: filterSemester || null },
    });
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// GET /schedule/master  — view the most recent master schedule (cached 10 min)
router.get('/master', auth, isAdmin, async (req, res) => {
  try {
    const master = await sc.getOrSet(SCHED_MASTER_KEY, async () => {
      return await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    }, sc.TTL.SCHEDULE);
    if (!master) return res.status(404).json({ message: 'No master schedule generated yet.' });
    res.json(master);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// DELETE /schedule/master  — wipe the master schedule (superadmin only)
router.delete('/master', auth, requireSuperAdmin, async (req, res) => {
  try {
    const deleted = await MasterSchedule.findOneAndDelete({}, { sort: { generatedAt: -1 } });
    if (!deleted) return res.status(404).json({ message: 'No master schedule found to delete.' });
    await Schedule.deleteMany({});
    invalidateScheduleCache();
    res.json({ message: `Master schedule (${deleted.semester} ${deleted.year}) deleted. All student schedules cleared.` });
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// GET /schedule/venues  — availability of every venue across the week (cached 10 min)
// Returns: { venues: [ { name, type, days: { Sunday: [ {start,end,free} ] } } ] }
router.get('/venues', auth, isAdmin, async (req, res) => {
  try {
    const cached = sc._cache.get(SCHED_VENUES_KEY);
    if (cached !== undefined) return res.json(cached);
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();

    // All fixed time slots (08:00â€“18:00, 2h each)
    const TIME_SLOTS = [];
    for (let m = 8 * 60; m + 120 <= 18 * 60; m += 120) {
      const toTime = (min) => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
      TIME_SLOTS.push({ start: toTime(m), end: toTime(m + 120) });
    }
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Saturday'];

    // Default venue list (matches generator)
    const ALL_VENUES = [
      { name: 'Amphitheatre 1', type: 'amphitheatre' },
      { name: 'Amphitheatre 2', type: 'amphitheatre' },
      { name: 'Amphitheatre 3', type: 'amphitheatre' },
      { name: 'Amphitheatre 4', type: 'amphitheatre' },
      { name: 'Lab 1',  type: 'lab' }, { name: 'Lab 2',  type: 'lab' },
      { name: 'Lab 3',  type: 'lab' }, { name: 'Lab 4',  type: 'lab' },
      { name: 'Lab 5',  type: 'lab' }, { name: 'Lab 6',  type: 'lab' },
      { name: 'Lab 7',  type: 'lab' }, { name: 'Lab 8',  type: 'lab' },
      { name: 'Room A5', type: 'room' },
      { name: 'Room A6', type: 'room' },
    ];

    // Build a Set of occupied venue+day+start keys from master slots
    const occupied = new Set();
    const slotInfo = {}; // key â†’ slot info (for tooltip)
    (master?.slots || []).forEach(s => {
      const key = `${s.venue}|${s.day}|${s.startTime}`;
      occupied.add(key);
      slotInfo[key] = { courseCode: s.courseCode, courseName: s.courseName, type: s.type, staffName: s.staffName };
    });

    const venues = ALL_VENUES.map(v => {
      const days = {};
      DAYS.forEach(day => {
        days[day] = TIME_SLOTS.map(ts => {
          const key = `${v.name}|${day}|${ts.start}`;
          const busy = occupied.has(key);
          return {
            start: ts.start,
            end:   ts.end,
            free:  !busy,
            ...(busy ? slotInfo[key] : {}),
          };
        });
      });
      return { name: v.name, type: v.type, days };
    });

    const payload = { venues, generatedAt: master?.generatedAt || null };
    sc._cache.set(SCHED_VENUES_KEY, payload, sc.TTL.SCHEDULE);
    res.json(payload);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// PER-STUDENT SCHEDULE  (generated from master)
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

// POST /schedule/generate/me
router.post('/generate/me', auth, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    if (!master) return res.status(400).json({ message: 'Master schedule not generated yet. Ask admin to generate it first.' });

    const student = await User.findById(req.userId)
      .populate('enrolledCourses', 'courseCode courseName _id').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (!student.lectureGroup || !student.section)
      return res.status(400).json({ message: 'Your group and section are not set. Please contact admin.' });

    const slots = generateSchedule(student, student.enrolledCourses || [], { _masterSlots: master.slots });
    const schedule = await Schedule.findOneAndUpdate(
      { student: req.userId },
      { student: req.userId, semester: master.semester, year: master.year, slots, generatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json(schedule);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// POST /schedule/generate/:studentId  â€” staff generate for a specific student
router.post('/generate/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    if (!master) return res.status(400).json({ message: 'Master schedule not generated yet.' });

    const student = await User.findById(req.params.studentId)
      .populate('enrolledCourses', 'courseCode courseName _id').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const slots = generateSchedule(student, student.enrolledCourses || [], { _masterSlots: master.slots });
    const schedule = await Schedule.findOneAndUpdate(
      { student: req.params.studentId },
      { student: req.params.studentId, semester: master.semester, year: master.year, slots, generatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json(schedule);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// POST /schedule/generate-all  â€” bulk generate for all students from master
router.post('/generate-all', auth, requireSuperAdmin, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    if (!master) return res.status(400).json({ message: 'Generate the master schedule first.' });

    const students = await User.find({ role: 'student' })
      .populate('enrolledCourses', 'courseCode courseName _id').lean();

    let generated = 0;
    for (const student of students) {
      if (!student.enrolledCourses?.length || !student.lectureGroup || !student.section) continue;
      const slots = generateSchedule(student, student.enrolledCourses, { _masterSlots: master.slots });
      await Schedule.findOneAndUpdate(
        { student: student._id },
        { student: student._id, semester: master.semester, year: master.year, slots, generatedAt: new Date() },
        { upsert: true }
      );
      generated++;
    }
    res.json({ message: `Schedules generated for ${generated} students.`, generated });
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// GET /schedule/group/:group/:section â€” preview slots for a specific group+section
router.get('/group/:group/:section', auth, isAdmin, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    if (!master) return res.status(404).json({ message: 'No master schedule found.' });

    const group   = Number(req.params.group);
    const section = Number(req.params.section);

    const slots = (master.slots || []).filter(s =>
      s.group === group &&
      (s.type === 'lecture' || (s.type === 'section' && s.section === section))
    );

    res.json({ group, section, slots, semester: master.semester, year: master.year, totalSlots: slots.length });
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// POST /schedule/force-group/:group/:section â€” push this group's schedule to all matching students
router.post('/force-group/:group/:section', auth, requireSuperAdmin, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    if (!master) return res.status(400).json({ message: 'Generate the master schedule first.' });

    const group   = Number(req.params.group);
    const section = Number(req.params.section);

    // Get the group+section slots from master
    const groupSlots = (master.slots || []).filter(s =>
      s.group === group &&
      (s.type === 'lecture' || (s.type === 'section' && s.section === section))
    );

    // Find all students in this group+section
    const students = await User.find({ role: 'student', lectureGroup: group, section }).lean();
    if (!students.length)
      return res.status(404).json({ message: `No students found in Group ${group} Section ${section}.` });

    let pushed = 0;
    for (const student of students) {
      await Schedule.findOneAndUpdate(
        { student: student._id },
        { student: student._id, semester: master.semester, year: master.year, slots: groupSlots, generatedAt: new Date() },
        { upsert: true }
      );
      pushed++;
    }

    res.json({
      message: `Schedule forced on ${pushed} student(s) in Group ${group} Section ${section}.`,
      pushed,
      group,
      section,
      slotsPerStudent: groupSlots.length,
    });
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// STAFF PERSONAL SCHEDULES
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

// GET /schedule/staff-list â€” list all doctors/assistants with slot counts (admin)
router.get('/staff-list', auth, isAdmin, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    const slotCounts = {};
    (master?.slots || []).forEach(s => {
      if (s.staffId) {
        const id = String(s.staffId);
        if (!slotCounts[id]) slotCounts[id] = 0;
        slotCounts[id]++;
      }
    });
    const staff = await User.find({ role: { $in: ['doctor', 'assistant'] } })
      .select('_id firstName lastName role email').lean();
    const result = staff.map(s => ({
      _id:       s._id,
      name:      `${s.firstName} ${s.lastName}`,
      role:      s.role,
      email:     s.email,
      slotCount: slotCounts[String(s._id)] || 0,
    }));
    res.json(result);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// GET /schedule/staff/me — returns this doctor/assistant's own slots from master (cached 10 min)
router.get('/staff/me', auth, async (req, res) => {
  try {
    const myId = String(req.userId);
    const result = await sc.getOrSet(schedStaffKey(myId), async () => {
      const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
      if (!master) return null;
      const slots = (master.slots || []).filter(s => String(s.staffId) === myId);
      return { slots, semester: master.semester, year: master.year, totalSlots: slots.length, generatedAt: master.generatedAt };
    }, sc.TTL.SCHEDULE);
    if (!result) return res.status(404).json({ message: 'No master schedule generated yet.' });
    res.json(result);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// GET /schedule/staff/:staffId — admin views any staff member's slots (cached 10 min)
router.get('/staff/:staffId', auth, isAdmin, async (req, res) => {
  try {
    const staffId = String(req.params.staffId);
    const result = await sc.getOrSet(schedStaffKey(staffId), async () => {
      const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
      if (!master) return null;
      const slots = (master.slots || []).filter(s => String(s.staffId) === staffId);
      const staff = await User.findById(staffId).select('firstName lastName role email').lean();
      return { slots, staff, semester: master.semester, year: master.year, totalSlots: slots.length };
    }, sc.TTL.SCHEDULE);
    if (!result) return res.status(404).json({ message: 'No master schedule generated yet.' });
    res.json(result);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// POST /schedule/force-staff-all â€” save each staff member's slots into their Schedule doc
router.post('/force-staff-all', auth, requireSuperAdmin, async (req, res) => {
  try {
    const master = await MasterSchedule.findOne().sort({ generatedAt: -1 }).lean();
    if (!master) return res.status(400).json({ message: 'Generate the master schedule first.' });

    // Collect unique staffIds from master slots
    const staffIdSet = new Set((master.slots || []).map(s => String(s.staffId)).filter(Boolean));
    let pushed = 0;
    for (const staffId of staffIdSet) {
      const mySlots = master.slots.filter(s => String(s.staffId) === staffId);
      await Schedule.findOneAndUpdate(
        { student: staffId },
        { student: staffId, semester: master.semester, year: master.year, slots: mySlots, generatedAt: new Date() },
        { upsert: true }
      );
      pushed++;
    }
    res.json({ message: `Schedule pushed to ${pushed} staff member(s).`, pushed });
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// READ
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ

router.get('/me', auth, async (req, res) => {
  try {
    const s = await Schedule.findOne({ student: req.userId }).lean();
    if (!s) return res.status(404).json({ message: 'No schedule yet. Generate it first.' });
    res.json(s);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

router.get('/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const s = await Schedule.findOne({ student: req.params.studentId }).lean();
    if (!s) return res.status(404).json({ message: 'No schedule found.' });
    res.json(s);
  } catch (e) { return sendError(res, 500, 'An error occurred', e); }
});

module.exports = router;
