local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, data = pcall(cjson.decode, raw)
if not ok then return 0 end
local count = (data['ref_count'] or 1) - 1
if count <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
data['ref_count'] = count
redis.call('SET', KEYS[1], cjson.encode(data))
return count
