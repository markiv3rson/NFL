# Starts the snapshot scheduler inside the single gunicorn worker.
def post_fork(server, worker):
    import scheduler
    scheduler.start()
