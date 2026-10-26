"""Conservative failure evidence. A failed conclusion alone is not a host incident."""
import re

FAILED_CONCLUSIONS = {'failure', 'timed_out', 'action_required', 'startup_failure'}
INFRASTRUCTURE_ERRORS = (
    ('runner-disconnected', r'(?:the )?self-hosted runner[^\n]*lost communication with the server',
     'runnerとGitHubの通信が切断されました', 'The runner lost communication with GitHub'),
    ('runner-shutdown', r'(?:the runner has received a shutdown signal|the runner process has been terminated)',
     'runnerが実行中に停止しました', 'The runner stopped during execution'),
    ('disk-full', r'(?:no space left on device|there is not enough space on the disk)',
     '実行環境のディスク容量が不足しました', 'The execution environment ran out of disk space'),
    ('disk-io', r'(?:input/output error|read-only file system)',
     '実行環境のディスクで入出力エラーが発生しました', 'The execution environment reported a disk I/O error'),
    ('docker-unavailable', r'cannot connect to the docker daemon at',
     'runnerからDockerに接続できませんでした', 'The runner could not connect to Docker'),
)


def failure_evidence(log_text):
    # Do not classify echoed test names, source snippets, or generic exit codes.
    for raw in log_text.splitlines():
        line = re.sub(r'^\d{4}-\d\d-\d\dT\S+\s+', '', raw).strip()
        if not (line.startswith('##[error]') or re.match(r'^(?:System\.IO\.(?:IOException|DriveNotFoundException)|OSError|IOError|Error: ENOSPC):', line)):
            continue
        line=re.sub(r'^##\[error\]\s*', '', line)
        line=re.sub(r'^(?:(?:System\.IO\.(?:IOException|DriveNotFoundException)|OSError|IOError|Error):\s*)?(?:ENOSPC:\s*|\[Errno 28\]\s*)?', '', line)
        for code, pattern, message, message_en in INFRASTRUCTURE_ERRORS:
            if re.match(pattern, line, re.I):
                return {'category': 'infrastructure', 'code': code, 'message': message,
                        'messageEn': message_en, 'source': 'job-log'}
    return {'category': 'unconfirmed', 'source': 'job-log'}


def infrastructure_jobs(ci, run):
    return [job for job in ci['jobs'] if job.get('repository') == run.get('repository')
            and job.get('run_id') == run['id'] and (job.get('run_attempt') or 1) == (run.get('run_attempt') or 1)
            and job.get('conclusion') in FAILED_CONCLUSIONS
            and job.get('failureCause', {}).get('category') == 'infrastructure']
