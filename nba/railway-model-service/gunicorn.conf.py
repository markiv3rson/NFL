# Starts the scheduler and the model loading inside the single gunicorn worker (threads must start AFTER the fork).
def post_fork(server, worker):
    import scheduler, app
    scheduler.start()
    app.start_background()
