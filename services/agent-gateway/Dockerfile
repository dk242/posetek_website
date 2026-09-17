# Minimal Python base — matches the other Cloud Run processors in this repo
# (Services/Standard-processor, Services/MMPose-processor) so there is one
# backend toolchain (LLM_PLATFORM_PLAN.md Part 9, batch B0). No ffmpeg/OpenCV
# system packages here — the gateway doesn't touch video.
FROM python:3.10-slim

WORKDIR /app

# Copy only requirements first to maximize pip layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Now copy the rest of the code (this changes often).
COPY . .

CMD ["python", "main.py"]
