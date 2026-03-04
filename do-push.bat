@echo off
cd /d "C:\Users\HP\IdeaProjects\section\uni-portal\backend"
git add routes/auth.js smtp-test.js
git commit -m "debug: expose smtp error + test-smtp endpoint"
git push
echo DONE > push-result.txt
git log --oneline -3 >> push-result.txt

