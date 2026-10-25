"""Present configured CI capacity without mistaking missing telemetry for idle runners."""
from collections import Counter


def server_capacity(ci, hosts, config):
    mappings = config.get('runnerHosts', {})
    assignments = Counter(name for mapping in mappings.values() for name in set(mapping.get('runnerNames', [])))
    fresh = ci.get('runnerInventoryState') == 'fresh'
    current_runs = {(r['repository'], r['id']): r for r in ci.get('runs', [])}
    active_jobs = []
    for job in ci.get('jobs', []):
        run = current_runs.get((job.get('repository'), job.get('run_id')))
        if job.get('status') != 'in_progress':
            continue
        if run and (run.get('status') == 'completed' or (job.get('run_attempt') or 1) != (run.get('run_attempt') or 1)):
            continue
        active_jobs.append(job)
    result = []
    for host_id, host in hosts.items():
        mapping = mappings.get(host_id, {})
        names = list(dict.fromkeys(mapping.get('runnerNames', [])))
        limit = mapping.get('maxJobs')
        if type(limit) is not int or limit < 1:
            limit = None
        rows = []
        for name in names:
            matches = [r for r in ci.get('runners', []) if r.get('name') == name]
            identities = {r.get('id') for r in matches}
            jobs = [j for j in active_jobs if j.get('runner_name') == name]
            state = 'unknown'
            runner = matches[0] if matches else {}
            if fresh and matches and assignments[name] == 1 and None not in identities and len(identities) == 1:
                statuses = {r.get('status') for r in matches}
                if statuses == {'offline'}:
                    state = 'offline'
                elif statuses == {'online'}:
                    busy = {r.get('busy') for r in matches}
                    if busy == {True}:
                        state = 'running'
                    elif busy == {False}:
                        state = 'idle'
            rows.append({'name': name, 'state': state, 'os': runner.get('os'),
                         'purpose': mapping.get('runnerPurposes',{}).get(name), 'jobs': jobs if state == 'running' else []})
        running = sum(r['state'] == 'running' for r in rows)
        idle = sum(r['state'] == 'idle' for r in rows)
        offline = sum(r['state'] == 'offline' for r in rows)
        unknown = sum(r['state'] == 'unknown' for r in rows)
        state = 'unconfigured' if not names or limit is None else 'unknown' if unknown else 'running' if running else 'idle' if idle else 'offline'
        available = min(idle, max(0, limit-running)) if limit is not None and not unknown and rows else None
        result.append({'hostId':host_id,'name':host.get('name',host_id),'state':state,'maxJobs':limit,
            'running':running,'idle':idle,'offline':offline,'unknown':unknown,'available':available,
            'atLimit':limit is not None and running>=limit,'overLimit':limit is not None and running>limit,
            'capacitySource':mapping.get('capacitySource','configured'),
            'capacityObservedAt':mapping.get('capacityObservedAt'), 'runners':rows})
    return result
