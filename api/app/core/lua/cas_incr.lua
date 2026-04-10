local raw = redis.call('GET', KEYS[1])
local data
if not raw then
  if ARGV[1] then
    data = cjson.decode(ARGV[1])
    data['ref_count'] = 1
  else
    return 0
  end
else
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok then return 0 end
  data = decoded
  data['ref_count'] = (data['ref_count'] or 1) + 1
  if ARGV[1] then
    local arg_data = cjson.decode(ARGV[1])
    if arg_data['scanned_at'] then
      data['scanned_at'] = arg_data['scanned_at']
    end
  end
end
redis.call('SET', KEYS[1], cjson.encode(data))
return data['ref_count']
