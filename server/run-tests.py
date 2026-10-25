"""Run both legacy hyphenated test files and the administration API test suite."""
from pathlib import Path
import subprocess
import sys

root=Path(__file__).parent.resolve()
for script in sorted(root.glob('test-*.py')):
    if sys.platform=='win32' and script.name in ('test-admin-broker.py','test-timecard-remote.py'):
        print('Linux-only Unix socket suite: run in Docker: '+script.name,flush=True)
        continue
    print('\nRunning '+script.name,flush=True)
    result=subprocess.run([sys.executable,str(script),'-v'],cwd=root)
    if result.returncode:raise SystemExit(result.returncode)
raise SystemExit(subprocess.call([sys.executable,'-m','unittest','discover','-s',str(root/'admin-api'),'-p','test*.py','-v'],cwd=root))
