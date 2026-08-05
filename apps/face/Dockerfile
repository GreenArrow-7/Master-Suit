# The models are ~275 MB and are NOT baked into the image: they are downloaded
# once into a named volume at /models, so rebuilding the image does not re-pull
# them and the layer cache stays small.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 FACE_MODEL_DIR=/models

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY face_engine.py main.py download_models.py ./

# One worker: each holds its own copy of the ONNX graphs in memory. Scale with
# replicas rather than workers if you need more throughput.
CMD ["sh", "-c", "python download_models.py && uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1"]
