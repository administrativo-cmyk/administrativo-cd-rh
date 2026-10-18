// Node IPC is tied to the actual parent process, unlike a reusable PID.
if (!process.channel) throw new Error("RUNTIME_CHILD_CHANNEL_REQUIRED");
process.once("disconnect", () => {
 process.emit("SIGTERM");
 const deadline = setTimeout(() => process.exit(1), 5000);
 deadline.unref();
});
