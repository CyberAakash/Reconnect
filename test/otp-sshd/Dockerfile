# Minimal sshd that offers ONLY keyboard-interactive (PAM) auth, so REConnect's
# OTP flow gets a real prompt to relay. The "OTP" you type is the unix password.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/sshd \
 && useradd -m -s /bin/bash tester \
 && echo 'tester:tester123' | chpasswd

COPY sshd_config /etc/ssh/sshd_config

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
