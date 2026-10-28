# shared by the /ia/ location and the redirect follower of le2-proxy.conf
proxy_buffering off;
proxy_request_buffering off;
proxy_max_temp_file_size 0;
proxy_connect_timeout 15s;
proxy_read_timeout 120s;
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Headers;
proxy_hide_header Access-Control-Allow-Credentials;
proxy_hide_header Set-Cookie;
add_header Access-Control-Allow-Origin $le2_cors_origin always;
add_header Access-Control-Expose-Headers "Content-Range, Content-Length, Accept-Ranges" always;
add_header Vary Origin always;
