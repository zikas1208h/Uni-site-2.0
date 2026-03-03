const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const bcrypt   = require('bcryptjs');

const User               = require('../models/User');
const Course             = require('../models/Course');
const Notification       = require('../models/Notification');
const { auth, isAdmin } = require('../middleware/auth');

// pdf-parse is required DYNAMICALLY inside handlers only.
const parsePDF = async (buffer) => {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  return pdfParse(buffer);
};

// xlsx parser — converts spreadsheet rows to plain text + structured rows
const parseExcel = (buffer) => {
  const XLSX = require('xlsx');
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  // Build plain text (tab-separated) for type detection
  const text  = rows.map(r => r.join('\t')).join('\n');
  // Structured rows (trimmed, non-empty cells)
  const structured = rows
    .map(r => r.map(c => String(c).trim()).filter(Boolean))
    .filter(r => r.length > 0);
  return { text, rows: structured, sheetName: wb.SheetNames[0], totalRows: rows.length };
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Excel files are allowed'));
    }
  },
});

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ── helpers ──────────────────────────────────────────────────────────────────
const norm = (s) => (s || '').toString().trim().toLowerCase();

// Smart type detection — works on Arabic and English headers + data patterns
const detectType = (text) => {
  const t = norm(text);
  if (/إعلان|منشور|circular|announcement|notice|memo|بلاغ/i.test(t))                              return 'announcement';
  if (/واجب|تسليم|assignment|homework|task|submit|deadline|due.?date/i.test(t))                   return 'assignment';
  if (/gpa|cgpa|معدل|grade.?point|transcript|academic.?standing|النتيجة/i.test(t))               return 'gpa_report';
  if (/امتحان|exam|midterm|final.?exam|quiz|جدول الاختبار/i.test(t))                             return 'exam';
  if (/طالب جديد|new.?student|admission|student.?list|student.?id|رقم الطالب|كشف الطلاب/i.test(t)) return 'students';
  if (/تغيير تخصص|major.?change|department.?transfer|نقل/i.test(t))                               return 'major_change';
  if (/مادة|مقرر|course|subject|curriculum|syllabus|credit.?hour|ساعات/i.test(t))                return 'courses';
  // Fallback: scan data patterns when no keywords match
  const hasStudentIds = (t.match(/\b\d{8,12}\b/g) || []).length >= 3;
  const hasCourseCode = /\b[a-z]{2,4}\d{3,4}\b/i.test(t);
  const hasGPAs       = (t.match(/\b[0-4]\.\d{1,2}\b/g) || []).length >= 2;
  if (hasGPAs && hasStudentIds) return 'gpa_report';
  if (hasStudentIds)            return 'students';
  if (hasCourseCode)            return 'courses';
  return 'unknown';
};

// Flexible column aliases — Arabic + English + common variations
const COLUMN_ALIASES = {
  studentId:  ['student id','student_id','id','رقم الطالب','رقم','الرقم','code','student no','no','serial','رقم القيد','كود الطالب'],
  firstName:  ['first name','firstname','first','الاسم الأول','اسم','given name'],
  lastName:   ['last name','lastname','surname','family','اسم العائلة','الكنية','اللقب'],
  fullName:   ['full name','fullname','name','الاسم الكامل','الاسم بالكامل','student name','اسم الطالب','الاسم'],
  email:      ['email','e-mail','mail','البريد الإلكتروني','البريد'],
  major:      ['major','department','dept','التخصص','القسم','program','البرنامج'],
  year:       ['year','academic year','السنة','المستوى','level','year of study'],
  semester:   ['semester','term','الفصل','الترم','الفصل الدراسي'],
  gpa:        ['gpa','cgpa','grade point','average','المعدل','المعدل التراكمي','grade','الدرجة','النتيجة'],
  courseCode: ['course code','code','كود المادة','رمز المادة','course id','subject code','رمز'],
  courseName: ['course name','subject','اسم المادة','المادة','المقرر','subject name'],
  credits:    ['credits','credit hours','hours','ساعات','الساعات','credit','units'],
};

const findColIndex = (headers, field) => {
  const aliases = COLUMN_ALIASES[field] || [];
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (!h) continue;
    for (const alias of aliases) {
      if (h === alias || h.includes(alias) || alias.includes(h)) return i;
    }
  }
  return -1;
};

const buildColMap = (headers) => {
  const map = {};
  for (const field of Object.keys(COLUMN_ALIASES)) {
    const idx = findColIndex(headers, field);
    if (idx !== -1) map[field] = idx;
  }
  return map;
};

const getCell = (row, map, field) => {
  if (map[field] === undefined) return '';
  return String(row[map[field]] || '').trim();
};

// Find the header row (first row with 2+ recognized column names, within first 10 rows)
const findHeaderRow = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const recognized = row.filter(cell => {
      const c = norm(cell);
      return Object.values(COLUMN_ALIASES).some(aliases =>
        aliases.some(a => c === a || c.includes(a) || a.includes(c))
      );
    });
    if (recognized.length >= 2) return i;
  }
  return 0;
};

// Extract student ID from any cell in a row
const extractStudentId = (row) => {
  for (const cell of row) {
    const s = String(cell).trim();
    if (/^\d{8,12}$/.test(s)) return s;
    const m = s.match(/\b(\d{8,12})\b/);
    if (m) return m[1];
  }
  return null;
};

// Extract GPA value (0.00–4.00) from any cell in a row
const extractGPA = (row) => {
  for (const cell of row) {
    const s = String(cell).trim();
    const n = parseFloat(s);
    if (!isNaN(n) && n >= 0 && n <= 4.0 && s.includes('.')) return s;
  }
  return null;
};

// Normalize major names to standard codes
const MAJOR_MAP = {
  'cs':'CS','computer science':'CS','علوم الحاسب':'CS','علوم حاسب':'CS',
  'ce':'CE','computer engineering':'CE','هندسة الحاسب':'CE',
  'is':'IS','information systems':'IS','نظم المعلومات':'IS',
  'it':'IT','information technology':'IT','تقنية المعلومات':'IT',
  'se':'SE','software engineering':'SE','هندسة البرمجيات':'SE',
  'ee':'EE','electrical':'EE','الهندسة الكهربائية':'EE',
  'mis':'MIS','management':'MIS',
};
const inferMajor = (text) => {
  if (!text) return 'CS';
  const t = norm(text);
  for (const [k, v] of Object.entries(MAJOR_MAP)) {
    if (t.includes(k)) return v;
  }
  const upper = text.toUpperCase().trim();
  if (/^(CS|CE|IS|IT|SE|EE|MIS|ECE)$/.test(upper)) return upper;
  return text.trim() || 'CS';
};



// â”€â”€ Main route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', auth, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const isExcel = /\.(xlsx|xls)$/i.test(req.file.originalname) ||
      req.file.mimetype.includes('spreadsheet') || req.file.mimetype.includes('excel');

    let fileText = '';
    let rows     = [];

    if (isExcel) {
      try {
        const parsed = parseExcel(req.file.buffer);
        fileText = parsed.text;
        rows     = parsed.rows;
      } catch (e) {
        return res.status(422).json({ message: 'Could not parse Excel file. Make sure it is a valid .xlsx or .xls file.' });
      }
    } else {
      // PDF
      try {
        const parsed = await parsePDF(req.file.buffer);
        fileText = parsed.text || '';
        rows = fileText.split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 3)
          .map(l => l.split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean));
      } catch (e) {
        return res.status(422).json({ message: 'Could not extract text from PDF. Make sure it is a text-based (not scanned) PDF.' });
      }
    }

    if (!fileText.trim()) {
      return res.status(422).json({ message: 'File appears to be empty or contains only images.' });
    }

    const overrideType = req.body.docType || null;
    const detectedType = overrideType || detectType(fileText);
    const lines = fileText.split('\n').map(l => l.trim()).filter(Boolean);

    let result = { type: detectedType, processed: 0, skipped: 0, errors: [], details: [] };

    // â”€â”€ ANNOUNCEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (detectedType === 'announcement') {
      // Extract title (first non-empty line) and body
      const title = lines[0] || 'Announcement';
      const body  = lines.slice(1).join('\n').slice(0, 1000) || fileText.slice(0, 1000);

      // Fan-out to all students (or targeted students if found)
      const students = await User.find({ role: 'student' }, { _id: 1 }).lean();
      const notifs = students.map(s => ({
        recipient: s._id,
        type: 'announcement',
        title,
        message: body,
        isRead: false,
      }));
      if (notifs.length > 0) await Notification.insertMany(notifs);

      result.processed = students.length;
      result.details.push({ action: 'Announcement sent', title, recipients: students.length });
    }

    // â”€â”€ ASSIGNMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (detectedType === 'assignment') {
      // Try to find course code mentioned in the text
      const codeMatch = fileText.match(/\b([A-Z]{2,4}\d{3,4}[A-Z]?)\b/);
      const courseCode = codeMatch ? codeMatch[1] : null;

      // Deadline
      const deadlineMatch = fileText.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
      const deadline = deadlineMatch ? new Date(deadlineMatch[1]) : new Date(Date.now() + 7 * 86400000);

      const title = lines[0] || 'Assignment';
      const description = lines.slice(1, 6).join(' ');

      result.processed = 1;
      result.details.push({
        action: 'Assignment data extracted â€” save via Assignments page',
        title,
        description,
        courseCode,
        deadline: deadline.toISOString().slice(0, 10),
        note: 'Use the extracted data to create the assignment in the Assignments tab.',
      });
    }

    // â”€â”€ GPA REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (detectedType === 'gpa_report') {
      const headerRowIdx = findHeaderRow(rows);
      const colMap       = buildColMap(rows[headerRowIdx] || []);
      const dataRows     = rows.slice(headerRowIdx + 1);
      const updated = [];

      for (const row of dataRows) {
        if (row.length < 2) continue;
        const studentId = (getCell(row, colMap, 'studentId') || extractStudentId(row) || '').replace(/\D/g,'');
        const gpa       = getCell(row, colMap, 'gpa') || extractGPA(row);
        if (!studentId || !gpa) continue;

        const student = await User.findOne({ studentId, role: 'student' }).lean();
        if (!student) { result.skipped++; result.errors.push(`Student ${studentId} not found`); continue; }

        await Notification.create({
          recipient: student._id, type: 'grade',
          title: 'GPA Update',
          message: `Your updated CGPA from the imported report: ${gpa}`,
          isRead: false,
        });
        updated.push({ studentId, gpa });
        result.processed++;
      }
      result.details = updated;
    }

    // â”€â”€ EXAM SCHEDULE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (detectedType === 'exam') {
      // Parse rows: courseCode  date  time  room
      const examRows = [];
      for (const row of rows) {
        if (row.length < 2) continue;
        const codeCell = row.find(c => /^[A-Z]{2,4}\d{3,4}[A-Z]?$/.test(c));
        const dateCell = row.find(c => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(c));
        if (!codeCell) continue;
        examRows.push({ courseCode: codeCell, date: dateCell || 'â€”', row: row.join(' | ') });
      }

      if (examRows.length > 0) {
        // Fan-out notifications to enrolled students for each course
        let notifCount = 0;
        for (const exam of examRows) {
          const course = await Course.findOne({ courseCode: exam.courseCode }).lean();
          if (!course) continue;
          const enrolledUsers = await User.find({ role: 'student', enrolledCourses: course._id }, { _id: 1 }).lean();
          const notifs = enrolledUsers.map(u => ({
            recipient: u._id, type: 'exam',
            title: `Exam Scheduled: ${exam.courseCode}`,
            message: `Your exam for ${exam.courseCode} is scheduled on ${exam.date}. Details: ${exam.row}`,
            isRead: false,
          }));
          if (notifs.length > 0) await Notification.insertMany(notifs);
          notifCount += notifs.length;
          result.processed++;
        }
        result.details = examRows;
        result.details.push({ notificationsSent: notifCount });
      } else {
        result.details.push({ note: 'No course codes found. Check PDF format.' });
      }
    }

    // â”€â”€ NEW STUDENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (detectedType === 'students') {
      // Find header row and build column map
      const headerRowIdx = findHeaderRow(rows);
      const headerRow    = rows[headerRowIdx] || [];
      const colMap       = buildColMap(headerRow);
      const dataRows     = rows.slice(headerRowIdx + 1);

      for (const row of dataRows) {
        if (row.length < 2) continue;

        // Try column map first, then fall back to pattern scanning
        let studentId = getCell(row, colMap, 'studentId') || extractStudentId(row);
        if (!studentId) { result.skipped++; continue; }

        // Clean studentId — digits only
        studentId = studentId.replace(/\D/g, '');
        if (studentId.length < 6) { result.skipped++; continue; }

        const exists = await User.findOne({ studentId }).lean();
        if (exists) { result.skipped++; continue; }

        // Name: try fullName column, then firstName+lastName, then non-digit cells
        let firstName = '', lastName = '';
        const fullName = getCell(row, colMap, 'fullName');
        if (fullName) {
          const parts = fullName.trim().split(/\s+/);
          firstName = parts[0] || 'Student';
          lastName  = parts.slice(1).join(' ') || '';
        } else {
          firstName = getCell(row, colMap, 'firstName');
          lastName  = getCell(row, colMap, 'lastName');
          if (!firstName) {
            // Fallback: non-digit, non-email cells
            const nameCells = row.filter(c => !/^\d/.test(c) && !/@/.test(c) && c.length > 1 && !/^[A-Z]{2,4}\d{3}/.test(c));
            firstName = nameCells[0] || 'Student';
            lastName  = nameCells[1] || '';
          }
        }

        const email     = getCell(row, colMap, 'email') || row.find(c => /@/.test(c)) || `${studentId}@hnu.edu.eg`;
        const majorRaw  = getCell(row, colMap, 'major') || row.find(c => /CS|CE|EE|IS|IT|MIS|SE/i.test(c)) || 'CS';
        const majorCode = inferMajor(majorRaw);
        const yearRaw   = getCell(row, colMap, 'year') || row.find(c => /^[1-4]$/.test(String(c))) || '1';
        const year      = parseInt(yearRaw) || 1;

        try {
          const hashedPwd = await bcrypt.hash('student123', 10);
          await User.create({ studentId, firstName, lastName, email, password: hashedPwd, role: 'student', major: majorCode, year });
          result.processed++;
          result.details.push({ action: 'Created', studentId, name: `${firstName} ${lastName}`, email, major: majorCode, year });
        } catch (e) {
          result.skipped++;
          result.errors.push(`${studentId}: ${e.message}`);
        }
      }
    }

    // â”€â”€ MAJOR CHANGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (detectedType === 'major_change') {
      for (const row of rows) {
        if (row.length < 2) continue;
        const idCell    = row.find(c => /^\d{8,12}$/.test(c));
        const majorCell = row.find(c => /^(CS|CE|EE|IS|IT|MIS|SE|ECE)$/i.test(c));
        if (!idCell || !majorCell) continue;

        const student = await User.findOne({ studentId: idCell, role: 'student' });
        if (!student) { result.skipped++; result.errors.push(`${idCell} not found`); continue; }

        const oldMajor = student.major;
        student.major = majorCell.toUpperCase();
        await student.save();

        await Notification.create({
          recipient: student._id, type: 'announcement',
          title: 'Major Change Approved',
          message: `Your major has been changed from ${oldMajor} to ${majorCell.toUpperCase()} as per the academic office decision.`,
          isRead: false,
        });
        result.processed++;
        result.details.push({ studentId: idCell, from: oldMajor, to: majorCell.toUpperCase() });
      }
    }

    // â”€â”€ COURSES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (detectedType === 'courses') {
      const headerRowIdx = findHeaderRow(rows);
      const colMap       = buildColMap(rows[headerRowIdx] || []);
      const dataRows     = rows.slice(headerRowIdx + 1);

      for (const row of dataRows) {
        if (row.length < 2) continue;

        // Course code: try column map, then pattern scan
        let courseCode = getCell(row, colMap, 'courseCode');
        if (!courseCode) {
          const found = row.find(c => /^[A-Z]{2,4}\d{3,4}[A-Z]?$/i.test(String(c).trim()));
          courseCode = found ? String(found).trim().toUpperCase() : null;
        }
        if (!courseCode) { result.skipped++; continue; }
        courseCode = courseCode.toUpperCase();

        const exists = await Course.findOne({ courseCode }).lean();
        if (exists) { result.skipped++; continue; }

        const courseName = getCell(row, colMap, 'courseName') ||
          row.filter(c => c !== courseCode && !/^\d+$/.test(c) && String(c).length > 3)
             .map(c => String(c)).join(' ').slice(0, 80) || courseCode;

        const creditsRaw = getCell(row, colMap, 'credits') || row.find(c => /^[1-6]$/.test(String(c))) || '3';
        const majorRaw   = getCell(row, colMap, 'major') || row.find(c => /CS|CE|EE|IS|IT|MIS|SE/i.test(String(c))) || 'Shared';
        const yearRaw    = getCell(row, colMap, 'year') || '1';
        const semRaw     = getCell(row, colMap, 'semester') || '1';

        try {
          await Course.create({
            courseCode,
            courseName,
            credits:  parseInt(creditsRaw) || 3,
            major:    inferMajor(majorRaw),
            year:     parseInt(yearRaw) || 1,
            semester: parseInt(semRaw) || 1,
            status: 'active',
          });
          result.processed++;
          result.details.push({ action: 'Course created', courseCode, courseName });
        } catch (e) {
          result.skipped++;
          result.errors.push(`${courseCode}: ${e.message}`);
        }
      }
    }

    // UNKNOWN
    else {
      result.details.push({
        note: 'Could not determine document type automatically.',
        hint: 'Use the "Document Type" override dropdown and re-upload.',
        preview: fileText.slice(0, 500),
      });
    }

    res.json({
      success: true,
      fileName: req.file.originalname,
      detectedType,
      overridden: !!overrideType,
      textLength: fileText.length,
      ...result,
    });

  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({ message: 'Import failed', error: error.message });
  }
});

// ── Preview only — extract text + detected columns without applying ────────
router.post('/preview', auth, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file' });

    const isExcel = /\.(xlsx|xls)$/i.test(req.file.originalname) ||
      req.file.mimetype.includes('spreadsheet') || req.file.mimetype.includes('excel');

    let text = '', rawRows = [], fileInfo = {};

    if (isExcel) {
      const parsed = parseExcel(req.file.buffer);
      text     = parsed.text;
      rawRows  = parsed.rows;
      fileInfo = { fileType: 'excel', sheetName: parsed.sheetName, totalRows: parsed.totalRows };
    } else {
      const parsed = await parsePDF(req.file.buffer);
      text    = parsed.text || '';
      rawRows = text.split('\n')
        .map(l => l.trim().split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean))
        .filter(r => r.length);
      fileInfo = { fileType: 'pdf' };
    }

    const detectedType = detectType(text);
    const lines        = text.split('\n').map(l => l.trim()).filter(Boolean);
    const headerRowIdx = findHeaderRow(rawRows);
    const colMap       = buildColMap(rawRows[headerRowIdx] || []);
    const detectedCols = Object.entries(colMap).map(([field, idx]) => ({
      field, column: idx,
      header: (rawRows[headerRowIdx] || [])[idx] || '',
    }));

    res.json({
      detectedType,
      lineCount: lines.length,
      preview: lines.slice(0, 30).join('\n'),
      headerRow: headerRowIdx,
      detectedColumns: detectedCols,
      ...fileInfo,
    });
  } catch (e) {
    res.status(422).json({ message: 'Could not parse file: ' + e.message });
  }
});

module.exports = router;










