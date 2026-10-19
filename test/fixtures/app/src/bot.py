from openai import OpenAI
client = OpenAI()
resp = client.chat.completions.create(model="gpt-3.5-turbo", messages=[])
summary = client.chat.completions.create(model="gpt-4o-mini", messages=[])
text = client.audio.transcriptions.create(model="whisper-1", file=f)
