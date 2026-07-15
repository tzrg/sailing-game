FROM nginx:alpine

# Statisches Spiel; nginx rendert das Template mit dem PORT, den Railway vorgibt.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public /usr/share/nginx/html

ENV PORT=8080
EXPOSE 8080
