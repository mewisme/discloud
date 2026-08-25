use std::net::TcpListener;

use super::LocalRuntimeError;

pub(super) const BACKEND_PREFERRED_PORT: u16 = 27_831;
pub(super) const POSTGRESQL_PREFERRED_PORT: u16 = 27_832;
pub(super) const WEB_PREFERRED_PORT: u16 = 27_833;
const FALLBACK_PORT_START: u16 = 27_834;
const FALLBACK_PORT_END: u16 = 27_999;

pub(super) fn choose_port(
    persisted: Option<u16>,
    preferred: u16,
) -> Result<u16, LocalRuntimeError> {
    if let Some(port) = persisted.filter(|port| port_available(*port)) {
        return Ok(port);
    }
    if port_available(preferred) {
        return Ok(preferred);
    }
    if let Some(port) = (FALLBACK_PORT_START..=FALLBACK_PORT_END).find(|port| port_available(*port))
    {
        return Ok(port);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| LocalRuntimeError::io("Could not allocate a local runtime port", error))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| {
            LocalRuntimeError::io("Could not resolve the allocated local runtime port", error)
        })
}

pub(super) fn port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::{
        choose_port, BACKEND_PREFERRED_PORT, POSTGRESQL_PREFERRED_PORT, WEB_PREFERRED_PORT,
    };

    #[test]
    fn preferred_ports_are_distinct() {
        assert_eq!(
            [
                BACKEND_PREFERRED_PORT,
                POSTGRESQL_PREFERRED_PORT,
                WEB_PREFERRED_PORT
            ],
            [27831, 27832, 27833]
        );
    }

    #[test]
    fn reuses_available_persisted_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(
            choose_port(Some(port), BACKEND_PREFERRED_PORT).unwrap(),
            port
        );
    }

    #[test]
    fn falls_back_when_preferred_port_is_busy() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let busy = listener.local_addr().unwrap().port();
        assert_ne!(choose_port(None, busy).unwrap(), busy);
    }
}
