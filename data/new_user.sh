curl -X 'POST' \
  'http://localhost:8000/auth/register' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "email": "julian.h.dale@gmail.com",
  "password": "maudib89",
  "is_active": true,
  "is_superuser": true,
  "is_verified": true,
  "name": "Julian Admin"
}'


curl -X 'POST' \
  'http://localhost:8000/auth/login' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&username=julian.h.dale%40gmail.com&password=maudib89&scope=&client_id=string&client_secret=********'